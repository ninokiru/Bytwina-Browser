//! Kho mật khẩu mã hóa tại chỗ (M11).
//!
//! - Khóa suy ra từ mật khẩu chủ bằng Argon2id (salt ngẫu nhiên 16 byte).
//! - Từng mục được mã hóa AES-256-GCM với nonce ngẫu nhiên 12 byte, nên hai
//!   mục giống hệt nhau vẫn ra bản mã khác nhau.
//! - Mật khẩu chủ không bao giờ được lưu; chỉ lưu salt và một bản mã "kiểm tra"
//!   để biết nhập đúng hay sai.
//! - Khóa chỉ nằm trong bộ nhớ tiến trình, tự mất khi thoát ứng dụng. Có thể
//!   khóa tay hoặc tự khóa sau một số phút rảnh.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use aes_gcm::aead::rand_core::RngCore;
use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD;
use base64::Engine as _;
use zeroize::Zeroizing;

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
/// Chuỗi cố định được mã hóa bằng khóa chủ để kiểm tra mật khẩu khi mở khóa.
const CHECK: &[u8] = b"bytwina-vault-v1";
/// 19 MiB, 2 vòng, 1 làn — mức khuyến nghị của OWASP cho Argon2id.
const MEM_KIB: u32 = 64 * 1024;
const TIME_COST: u32 = 3;
const PARALLELISM: u32 = 4;

pub fn new_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

/// Khóa chủ đã dẫn xuất. Không `Clone`, không `Copy`: `Zeroizing` xóa bộ nhớ lúc
/// drop, còn mỗi lần sao chép thô sẽ để lại bản khóa sống sờ sờ trên heap — chính
/// là lỗ hổng mà struct này tồn tại để chặn.
pub struct SecretKey(Zeroizing<[u8; KEY_LEN]>);

impl SecretKey {
    pub fn bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

pub fn derive_key(password: &str, salt: &[u8]) -> Result<SecretKey, String> {
    let params = Params::new(MEM_KIB, TIME_COST, PARALLELISM, Some(KEY_LEN))
        .map_err(|e| e.to_string())?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| "không băm được mật khẩu chủ".to_string())?;
    Ok(SecretKey(key))
}

/// Trả về nonce || bản mã. GCM đã xác thực toàn vẹn nên giải mã sai khóa sẽ lỗi.
pub fn seal(key: &SecretKey, plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new_from_slice(key.bytes()).map_err(|_| "khóa mã hóa không hợp lệ".to_string())?;
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ct = cipher
        .encrypt(Nonce::from_slice(&nonce), plain)
        .map_err(|_| "không mã hóa được dữ liệu".to_string())?;
    let mut out = Vec::with_capacity(NONCE_LEN + ct.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ct);
    Ok(out)
}

pub fn open(key: &SecretKey, blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() <= NONCE_LEN {
        return Err("dữ liệu mã hóa không hợp lệ".into());
    }
    let cipher = Aes256Gcm::new_from_slice(key.bytes()).map_err(|_| "khóa mã hóa không hợp lệ".to_string())?;
    let (nonce, ct) = blob.split_at(NONCE_LEN);
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "sai mật khẩu chủ hoặc dữ liệu đã bị hỏng".to_string())
}

pub fn check_blob(key: &SecretKey) -> Result<Vec<u8>, String> {
    seal(key, CHECK)
}

pub fn verify_check(key: &SecretKey, blob: &[u8]) -> Result<(), String> {
    let plain = open(key, blob)?;
    if plain == CHECK {
        Ok(())
    } else {
        Err("mật khẩu chủ không đúng".into())
    }
}

pub fn encode(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

pub fn decode(text: &str) -> Result<Vec<u8>, String> {
    STANDARD
        .decode(text.trim())
        .map_err(|_| "dữ liệu lưu trữ không hợp lệ".to_string())
}

struct Unlocked {
    key: SecretKey,
    last: Instant,
}

const MAX_UNLOCK_FAILURES: u8 = 5;
const UNLOCK_COOLDOWN: Duration = Duration::from_secs(30);

/// Trạng thái mở khóa của kho trong phiên chạy. `timeout_minutes = 0` là
/// không tự khóa; khóa vẫn mất khi thoát ứng dụng.
#[derive(Default)]
pub struct PasswordVault {
    inner: Mutex<Option<Unlocked>>,
    failed_unlocks: Mutex<(u8, Option<Instant>)>,
}

impl PasswordVault {
    /// Chặn thử mật khẩu liên tục trong cùng phiên chạy để giảm brute-force online.
    pub fn allow_unlock_attempt(&self) -> Result<(), String> {
        let mut state = self
            .failed_unlocks
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(until) = state.1 {
            if Instant::now() < until {
                let seconds = until.saturating_duration_since(Instant::now()).as_secs().max(1);
                return Err(format!("thử quá nhiều lần; hãy chờ {seconds} giây"));
            }
            state.1 = None;
        }
        Ok(())
    }

    pub fn record_unlock_failure(&self) {
        let mut state = self
            .failed_unlocks
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        state.0 = state.0.saturating_add(1);
        if state.0 >= MAX_UNLOCK_FAILURES {
            state.0 = 0;
            state.1 = Some(Instant::now() + UNLOCK_COOLDOWN);
        }
    }

    pub fn reset_unlock_failures(&self) {
        let mut state = self
            .failed_unlocks
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        *state = (0, None);
    }

    pub fn unlock(&self, key: SecretKey) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(Unlocked {
            key,
            last: Instant::now(),
        });
    }

    /// Trả khóa về None; `SecretKey` drop và `Zeroizing` xóa 32 byte đó.
    pub fn lock(&self) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;
    }

    /// Chạy `f` với khóa đang mở. Khóa KHÔNG được sao chép ra ngoài — đây là lý do
    /// API là closure thay vì trả `[u8; 32]` như trước.
    /// Không được gọi lại vào vault bên trong `f`: đang giữ khóa Mutex.
    pub fn with_key<R>(
        &self,
        timeout_minutes: u64,
        f: impl FnOnce(&SecretKey) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(state) = guard.as_mut() else {
            return Err("kho mật khẩu đang khóa".into());
        };
        if self.expired(state, timeout_minutes) {
            *guard = None;
            return Err("kho mật khẩu đã tự khóa do không thao tác".into());
        }
        state.last = Instant::now();
        f(&state.key)
    }

    pub fn is_unlocked(&self, timeout_minutes: u64) -> bool {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        match guard.as_mut() {
            None => false,
            Some(state) => {
                if self.expired(state, timeout_minutes) {
                    *guard = None;
                    false
                } else {
                    true
                }
            }
        }
    }

    /// Khóa theo đồng hồ, không chỉ khi có người gọi: vòng lặp nền của ứng dụng
    /// gọi mỗi 30 giây để kho không giữ khóa vô hạn khi người dùng bỏ đó.
    pub fn expire(&self, timeout_minutes: u64) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(state) = guard.as_mut() {
            if self.expired(state, timeout_minutes) {
                *guard = None;
            }
        }
    }

    fn expired(&self, state: &Unlocked, timeout_minutes: u64) -> bool {
        if timeout_minutes == 0 {
            return false;
        }
        let limit = Duration::from_secs(timeout_minutes.saturating_mul(60));
        state.last.elapsed() >= limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypt_roundtrip_and_wrong_key_fails() {
        let salt = new_salt();
        let key = derive_key("mật khẩu chủ đủ dài", &salt).unwrap();
        let blob = seal(&key, b"secret-value").unwrap();
        assert_eq!(open(&key, &blob).unwrap(), b"secret-value");
        // Hai lần mã hóa cùng dữ liệu phải ra bản mã khác nhau (nonce ngẫu nhiên).
        assert_ne!(blob, seal(&key, b"secret-value").unwrap());
        let other = derive_key("mật khẩu khác", &salt).unwrap();
        assert!(open(&other, &blob).is_err());
    }

    #[test]
    fn check_blob_verifies_master_password() {
        let key = derive_key("abcdefgh", &new_salt()).unwrap();
        let check = check_blob(&key).unwrap();
        verify_check(&key, &check).unwrap();
        let wrong = derive_key("abcdefgi", &new_salt()).unwrap();
        assert!(verify_check(&wrong, &check).is_err());
    }

    #[test]
    fn vault_locks_when_asked_and_expire_leaves_it_alone_when_disabled() {
        let vault = PasswordVault::default();
        vault.unlock(key_of(7));
        assert!(vault.is_unlocked(0));
        // timeout 0 = không tự khóa: vòng nền gọi expire(0) phải không được khóa.
        vault.expire(0);
        assert!(vault.is_unlocked(0));
        vault.lock();
        assert!(!vault.is_unlocked(0));
        // Khóa rồi thì mọi thao tác cần khóa phải lỗi, không được trả khóa cũ.
        assert!(vault.with_key(0, |_| Ok(())).is_err());
        // Không thể chờ hết một phút trong test: đường quá hạn dùng đồng hồ như
        // nhau, chỉ khác ở chỗ expire() được vòng lặp nền gọi định kỳ.
    }

    #[test]
    fn with_key_gives_the_same_key_that_unlocked_the_vault() {
        let vault = PasswordVault::default();
        let salt = new_salt();
        let key = derive_key("mật khẩu chủ đủ dài", &salt).unwrap();
        let expected = *key.bytes();
        vault.unlock(key);
        let got = vault
            .with_key(0, |k| Ok(*k.bytes()))
            .expect("kho đang khóa");
        assert_eq!(got, expected);
    }

    fn key_of(byte: u8) -> SecretKey {
        SecretKey(Zeroizing::new([byte; KEY_LEN]))
    }
}
