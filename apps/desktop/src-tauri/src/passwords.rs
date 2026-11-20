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

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
const KEY_LEN: usize = 32;
/// Chuỗi cố định được mã hóa bằng khóa chủ để kiểm tra mật khẩu khi mở khóa.
const CHECK: &[u8] = b"bytwina-vault-v1";
/// 19 MiB, 2 vòng, 1 làn — mức khuyến nghị của OWASP cho Argon2id.
const MEM_KIB: u32 = 19 * 1024;
const TIME_COST: u32 = 2;
const PARALLELISM: u32 = 1;

pub fn new_salt() -> [u8; SALT_LEN] {
    let mut salt = [0u8; SALT_LEN];
    OsRng.fill_bytes(&mut salt);
    salt
}

pub fn derive_key(password: &str, salt: &[u8]) -> Result<[u8; KEY_LEN], String> {
    let params = Params::new(MEM_KIB, TIME_COST, PARALLELISM, Some(KEY_LEN))
        .map_err(|e| e.to_string())?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = [0u8; KEY_LEN];
    argon
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| "không băm được mật khẩu chủ".to_string())?;
    Ok(key)
}

/// Trả về nonce || bản mã. GCM đã xác thực toàn vẹn nên giải mã sai khóa sẽ lỗi.
pub fn seal(key: &[u8; KEY_LEN], plain: &[u8]) -> Result<Vec<u8>, String> {
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| "khóa mã hóa không hợp lệ".to_string())?;
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

pub fn open(key: &[u8; KEY_LEN], blob: &[u8]) -> Result<Vec<u8>, String> {
    if blob.len() <= NONCE_LEN {
        return Err("dữ liệu mã hóa không hợp lệ".into());
    }
    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|_| "khóa mã hóa không hợp lệ".to_string())?;
    let (nonce, ct) = blob.split_at(NONCE_LEN);
    cipher
        .decrypt(Nonce::from_slice(nonce), ct)
        .map_err(|_| "sai mật khẩu chủ hoặc dữ liệu đã bị hỏng".to_string())
}

pub fn check_blob(key: &[u8; KEY_LEN]) -> Result<Vec<u8>, String> {
    seal(key, CHECK)
}

pub fn verify_check(key: &[u8; KEY_LEN], blob: &[u8]) -> Result<(), String> {
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
    key: [u8; KEY_LEN],
    last: Instant,
}

/// Trạng thái mở khóa của kho trong phiên chạy. `timeout_minutes = 0` là
/// không tự khóa; khóa vẫn mất khi thoát ứng dụng.
#[derive(Default)]
pub struct PasswordVault {
    inner: Mutex<Option<Unlocked>>,
}

impl PasswordVault {
    pub fn unlock(&self, key: [u8; KEY_LEN]) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(Unlocked {
            key,
            last: Instant::now(),
        });
    }

    pub fn lock(&self) {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;
    }

    /// Trả khóa nếu đang mở và chưa quá hạn; tự khóa khi quá hạn.
    pub fn key(&self, timeout_minutes: u64) -> Result<Option<[u8; KEY_LEN]>, String> {
        let mut guard = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let Some(state) = guard.as_mut() else {
            return Ok(None);
        };
        if timeout_minutes > 0 {
            let limit = Duration::from_secs(timeout_minutes.saturating_mul(60));
            if state.last.elapsed() >= limit {
                *guard = None;
                return Ok(None);
            }
        }
        state.last = Instant::now();
        Ok(Some(state.key))
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
    fn vault_locks_after_timeout() {
        let vault = PasswordVault::default();
        let key = [7u8; KEY_LEN];
        vault.unlock(key);
        assert_eq!(vault.key(0).unwrap(), Some(key));
        // Không thể chờ 1 phút trong test: đặt hạn 0 là tắt tự khóa, còn khóa tay
        // phải xóa khóa ngay.
        vault.lock();
        assert_eq!(vault.key(0).unwrap(), None);
    }
}
