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

    fn engine_with(debug: bool, rules: &str) -> Engine {
        let mut set = FilterSet::new(debug);
        set.add_filter_list(rules.to_string(), ParseOptions::default());
        Engine::new_with_filter_set(set)
    }

    /// Như production thật (filters::build_engine): `new_with_filter_set` bật
    /// tối ưu của NetworkRulesBuilder, còn đường cache engine của Blocker thì
    /// dùng `serialize`/`deserialize`. Hai đường này có thể xử lý cosmetic khác
    /// nhau, nên test cuối phải đi đúng đường production.
    fn production_engine(rules: &str) -> Engine {
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

    /// Chạy khi truy tìm lý do luật chung không ra selector: in ra engine đã
    /// nhận/trả về những gì. Bỏ qua ở lần chạy thường; chạy bằng
    /// `cargo test -- --ignored --nocapture`. Dòng thăm dò bắt đầu bằng
    /// SUMMARY: để ci.yml đưa vào Summary (đọc được từ trang run công khai).
    #[test]
    #[ignore]
    fn debug_dump_generic_rules() {
        for (label, rules) in [
            ("plain", ".advert\n#sponsor\n"),
            ("short", ".ad\n#spon\n"),
            ("with_host", "any.test##.advert\n"),
            ("class_list", ".advert\n.ad-banner\n"),
        ] {
            let e = engine_with(true, rules);
            let all = e.url_cosmetic_resources("https://any.test/");
            let by_class = e.hidden_class_id_selectors(
                ["advert", "ad-banner", "ad"],
                ["sponsor", "spon"],
                &all.exceptions,
            );
            println!("SUMMARY:[{label}] hide={:?} by_class={:?}", all.hide_selectors, by_class);
        }
        // Bảng hash của adblock phụ thuộc features: dò key rỗng — engine có
        // trả selector "" cho class "" không.
        let e = engine_with(true, ".advert\n");
        println!(
            "SUMMARY:empty_class={:?} empty_id={:?}",
            e.hidden_class_id_selectors([""], [""], &Default::default()),
            e.url_cosmetic_resources("https://any.test/").hide_selectors,
        );
        // Bảng key rỗng không traverse được (0 là sentinel null): nếu class ""
        // không có, key thật CŨNG không tìm thấy. Thử chuỗi 1 ký tự a..z để
        // xác nhận tìm kiếm nói chung hỏng.
        let keys: Vec<&str> = "abcdefghijklmnopqrstuvwxyz".split("").skip(1).collect();
        println!(
            "SUMMARY:single_letters={:?}",
            e.hidden_class_id_selectors(keys.clone(), keys, &Default::default())
        );
        let all = engine_with(true, ".a\n#a\n");
        println!(
            "SUMMARY:rule_a={:?}",
            all.hidden_class_id_selectors(["a"], ["a"], &Default::default())
        );
        // Đường production (Blocker::load, có thể qua cache serialize): luật
        // chung còn sống không? So với debug=false để thấy chênh lệch.
        for debug in [true, false] {
            let e = engine_with(debug, ".advert\n");
            println!(
                "SUMMARY:opt_{debug}={:?}",
                e.hidden_class_id_selectors(["advert"], [""], &Default::default())
            );
        }
        let p = production_engine(".advert\n");
        println!(
            "SUMMARY:production={:?}",
            p.hidden_class_id_selectors(["advert"], [""], &Default::default())
        );
    }

    #[test]
    fn generic_rules_need_page_classes_and_ids() {
        // Đi đúng đường production: Blocker.load() có thể đi qua cache/serialize.
        let e = production_engine(".advert\n#sponsor\n");
        // Chưa đưa class/id thì chưa ẩn được gì: đó là giới hạn của bộ lọc chung.
        assert!(stylesheet(&e, "https://any.test/", &[], &[]).is_empty());
        let css = stylesheet(
            &e,
            "https://any.test/",
            &["advert".to_string()],
            &["sponsor".to_string()],
        );
        assert!(!css.is_empty(), "{css}");
        assert!(count(&css) >= 1, "{css}");
    }

    #[test]
    fn generichide_exception_stops_generic_rules_on_that_page() {
        // `$generichide` là ngoại lệ MẠNG: nó tắt luôn nhóm luật chung mà engine tự
        // tính trong hide_selectors, chỉ giữ luật theo tên miền.
        let e = engine(".advert\n@@||hide.me$generichide\n");
        let r = e.url_cosmetic_resources("https://hide.me/");
        assert!(r.generichide, "phải bật cờ generichide");
        assert!(!r.hide_selectors.contains(".advert"), "{:?}", r.hide_selectors);
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
}
