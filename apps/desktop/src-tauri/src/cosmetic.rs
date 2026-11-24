//! Lọc thẩm mỹ (M4b): ẩn phần tử quảng cáo bằng CSS, không chặn request.
//!
//! Hai nguồn selector, đúng theo tài liệu của crate `adblock`:
//! - `url_cosmetic_resources(url)` cho bộ chọn theo tên miền (`example.org##.ad`).
//! - `hidden_class_id_selectors(classes, ids, exceptions)` cho luật chung
//!   (`.ad`, `#banner`) — cần danh sách class/id thật của trang, nên phải hỏi
//!   trang trước. Nếu trang có ngoại lệ `$generichide` thì bỏ qua bước này.
//!
//! Kết quả là một khối CSS `display:none!important`. Procedural filters
//! (`:has()`, `:upward()`…) và scriptlet KHÔNG được xử lý ở đây: crate chỉ trả về
//! mô tả JSON, việc match DOM phải viết tay trong JS — để riêng, không làm nửa vời.

use std::collections::HashSet;

use adblock::engine::Engine;

/// Điểm nối WebView2: đọc class/id của trang rồi chèn CSS.
#[cfg(target_os = "windows")]
pub mod webview2;

/// CSS chèn vào trang. Rỗng nếu không có gì để ẩn.
pub fn stylesheet(engine: &Engine, url: &str, classes: &[String], ids: &[String]) -> String {
    let resources = engine.url_cosmetic_resources(url);
    let mut selectors: Vec<String> = resources.hide_selectors.iter().cloned().collect();

    // Luật chung chỉ tra được khi biết class/id của trang; sinh ra từ chính DOM
    // nên không thể tính sẵn lúc điều hướng.
    if !resources.generichide && (!classes.is_empty() || !ids.is_empty()) {
        selectors.extend(engine.hidden_class_id_selectors(classes, ids, &exceptions(&resources)));
    }

    // Các luật ẩn quảng cáo CSS chuẩn cho YouTube, TikTok (thuộc tính data-* ổn định)
    if url.contains("youtube.com") {
        for s in [
            "ytd-ad-slot-renderer",
            "ytd-in-feed-ad-layout-renderer",
            "ytd-promoted-sparkles-web-renderer",
            "ytd-companion-slot-renderer",
            "#player-ads",
            "#masthead-ad",
            ".ytp-ad-module",
            ".ytp-ad-overlay-container",
            "tp-yt-paper-dialog:has(#feedback.ytd-enforcement-message-view-model)",
        ] {
            selectors.push(s.to_string());
        }
    } else if url.contains("tiktok.com") {
        // Dùng thuộc tính ổn định data-e2e thay vì hash class
        for s in ["div[data-e2e='feed-ad']", ".ad-badge"] {
            selectors.push(s.to_string());
        }
    }

    // Generic rules are deliberately restricted to known ad-heavy domains.
    // Unknown sites keep only rules explicitly present in the downloaded list.
    if is_high_risk(url) && !resources.generichide {
        selectors.extend(generic_selectors(classes, ids));
    }

    selectors.sort();
    selectors.dedup();
    if selectors.is_empty() {
        return String::new();
    }
    // Mỗi selector một dòng, ngăn cách bằng dấu phẩy: nếu một selector lỗi thời
    // với engine CSS của WebView2 thì các selector khác vẫn còn hiệu lực? Không —
    // CSS gộp dấu phẩy sẽ bỏ cả khối. Tách từng cái một là đánh đổi kích thước lấy
    // độ bền, đáng vì số quy tắc mỗi trang thường nhỏ.
    selectors
        .iter()
        .map(|s| format!("{s}{{display:none!important;}}"))
        .collect::<Vec<_>>()
        .join("")
}

pub fn is_high_risk(url: &str) -> bool {
    let host = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_ascii_lowercase))
        .unwrap_or_default();
    [
        "youtube.com",
        "facebook.com",
        "instagram.com",
        "tiktok.com",
        "vnexpress.net",
        "dantri.com.vn",
        "tuoitre.vn",
        "thanhnien.vn",
        "kenh14.vn",
        "cafebiz.vn",
        "genk.vn",
    ]
    .iter()
    .any(|domain| host == *domain || host.ends_with(&format!(".{domain}")))
}

fn generic_selectors(classes: &[String], ids: &[String]) -> Vec<String> {
    const SAFE: &[&str] = &["address-block", "adaptation", "adoption", "badge", "header"];
    const TERMS: &[&str] = &[
        "ad",
        "ads",
        "advert",
        "advertisement",
        "banner",
        "sponsor",
        "promoted",
    ];
    let mut out = vec![
        "[id^='banner']:not(#banner-header)".to_string(),
        ".sponsor:not(.sponsor-header)".to_string(),
    ];
    for class in classes {
        let lower = class.to_ascii_lowercase();
        if SAFE.contains(&lower.as_str()) || !TERMS.iter().any(|term| lower.contains(term)) {
            continue;
        }
        if class
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            out.push(format!(".{class}"));
        }
    }
    for id in ids {
        let lower = id.to_ascii_lowercase();
        if SAFE.contains(&lower.as_str()) || !TERMS.iter().any(|term| lower.contains(term)) {
            continue;
        }
        if id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            out.push(format!("#{id}"));
        }
    }
    out
}

fn exceptions(resources: &adblock::cosmetic_filter_cache::UrlSpecificResources) -> HashSet<String> {
    resources.exceptions.clone()
}

/// Số quy tắc thực sự nằm trong CSS, tính bằng cách đếm khối `display:none`.
/// Có tác dụng ngoài test: nơi gọi dùng nó để ghi log số phần tử đã ẩn.
pub fn count(selectors_css: &str) -> usize {
    if selectors_css.is_empty() {
        return 0;
    }
    selectors_css.matches("display:none!important").count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use adblock::lists::ParseOptions;
    use adblock::{Engine, FilterSet};
    use std::sync::Arc;

    fn engine_with(debug: bool, rules: &str) -> Engine {
        let mut set = FilterSet::new(debug);
        set.add_filter_list(rules.to_string(), ParseOptions::default());
        Engine::new_with_filter_set(set)
    }

    /// Như production thật (filters::build_engine): đường Blocker::load có thể
    /// đi qua cache engine (`serialize`/`deserialize`), thứ mà
    /// `Engine::new_with_filter_set` không chạm tới. Hai đường này có thể xử lý
    /// cosmetic khác nhau, nên test cuối phải đi đúng đường production.
    fn production_engine(rules: &str) -> Arc<Engine> {
        let dir = std::env::temp_dir().join(format!(
            "bytwina-cosmetic-{}-{}",
            std::process::id(),
            line!()
        ));
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(dir.join("test.txt"), rules);
        let blocker = crate::filters::Blocker::new(dir);
        blocker.load().expect("nạp danh sách thất bại");
        blocker.snapshot_engine().expect("engine chưa nạp")
    }

    fn engine(rules: &str) -> Engine {
        engine_with(false, rules)
    }

    #[test]
    fn domain_rules_hide_without_help_from_the_page() {
        let e = engine("news.example##.promo\n");
        let css = stylesheet(&e, "https://news.example/article", &[], &[]);
        assert!(css.contains(".promo"), "{css}");
        assert_eq!(count(&css), 1);
    }

    /// Đo luật chung trên nhiều đường nạp cùng lúc: sau khi CI in ra
    /// (hide={} by_class=[] cho cả debug, không debug và qua Blocker/cache),
    /// luật chung được ghi nhận là chưa hoạt động. Giữ lại để đo khi adblock
    /// lên phiên bản mới; bỏ qua ở lần chạy thường, chạy bằng
    /// `cargo test -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn generic_rule_coverage_probe() {
        for (label, rules) in [
            ("plain", ".advert\n#sponsor\n"),
            ("short", ".ad\n#spon\n"),
            ("with_host", "any.test##.advert\n"),
            ("class_list", ".advert\n.ad-banner\n"),
        ] {
            let e = engine_with(true, rules);
            let all = e.url_cosmetic_resources("https://any.test/");
            let by_class = e.hidden_class_id_selectors(
                ["advert", "ad-banner"],
                ["sponsor", "spon"],
                &all.exceptions,
            );
            println!(
                "[{label}] hide={:?} by_class={:?}",
                all.hide_selectors, by_class
            );
        }
        let p = production_engine(".advert\n");
        println!(
            "production by_class={:?}",
            p.hidden_class_id_selectors(["advert"], [""], &Default::default())
        );
    }

    /// Luật chung là phần chưa chạy được (bằng chứng ở generic_rule_coverage_probe),
    /// nên kiểm đúng điều code sở hữu: không có class/id → không thêm gì; có
    /// class/id → CSS của luật theo tên miền vẫn được ghép bình thường.
    #[test]
    fn generic_input_never_breaks_domain_rules() {
        let e = engine("any.test##.promo\n");
        let none = stylesheet(&e, "https://any.test/", &[], &[]);
        assert_eq!(none, ".promo{display:none!important;}");
        let with_page = stylesheet(
            &e,
            "https://any.test/",
            &["advert".to_string()],
            &["sponsor".to_string()],
        );
        assert!(with_page.contains(".promo"), "{with_page}");
        assert_eq!(count(&with_page), 1, "{with_page}");
    }

    #[test]
    fn generichide_exception_stops_generic_rules_on_that_page() {
        // `$generichide` là ngoại lệ MẠNG: nó tắt luôn nhóm luật chung mà engine tự
        // tính trong hide_selectors, chỉ giữ luật theo tên miền.
        let e = engine(".advert\n@@||hide.me$generichide\n");
        let r = e.url_cosmetic_resources("https://hide.me/");
        assert!(r.generichide, "phải bật cờ generichide");
        assert!(
            !r.hide_selectors.contains(".advert"),
            "{:?}",
            r.hide_selectors
        );
    }

    #[test]
    fn exception_selector_wins_over_generic_rule() {
        let e = engine(".ad\nhide.me#@#.ad\n");
        let css = stylesheet(&e, "https://hide.me/", &["ad".to_string()], &[]);
        assert!(!css.contains(".ad"), "{css}");
    }

    #[test]
    fn domain_specific_rules_survive_generichide() {
        let e = engine(".advert\nhide.me##.keepme\n@@||hide.me$generichide\n");
        let css = stylesheet(&e, "https://hide.me/", &[], &[]);
        assert!(css.contains(".keepme"), "{css}");
        assert!(!css.contains(".advert"), "{css}");
    }

    #[test]
    fn each_rule_is_emitted_separately_and_deduped() {
        let e = engine("a.test##.x\na.test##.y\n");
        let css = stylesheet(&e, "https://a.test/", &[], &[]);
        assert_eq!(count(&css), 2, "{css}");
        assert!(!css.contains(".x,.y"), "không được gộp dấu phẩy: {css}");
    }

    #[test]
    fn empty_engine_produces_no_css() {
        let e = engine("! chỉ comment\n");
        assert!(stylesheet(&e, "https://a.test/", &["x".to_string()], &[]).is_empty());
        assert_eq!(count(""), 0);
    }

    #[test]
    fn generic_rules_are_scoped_and_whitelisted() {
        assert!(is_high_risk("https://news.vnexpress.net/a"));
        assert!(!is_high_risk("https://example.com/a"));
        let selectors = generic_selectors(
            &["ad-box".into(), "address-block".into(), "content".into()],
            &["banner-top".into()],
        );
        assert!(selectors.iter().any(|s| s == ".ad-box"));
        assert!(selectors.iter().any(|s| s == "#banner-top"));
        assert!(!selectors.iter().any(|s| s == ".address-block"));
    }
}
