use serde::Serialize;

/// Một mục trong danh sách URL gần nhất của tab (history + forward gộp lại).
#[derive(Clone, Debug)]
pub struct HistoryEntry {
    pub url: String,
    #[allow(dead_code)] // tiêu đề trang: dùng cho M2 (lịch sử) và M5.
    pub title: String,
}

/// Trạng thái một tab, mô tả đủ cho frontend vẽ tab bar và address bar.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TabInfo {
    pub id: u32,
    pub label: String,
    pub url: String,
    pub title: String,
    pub loading: bool,
    /// false khi tab chưa tạo webview (lazy creation — hoàn tác ở M6).
    pub created: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    /// M5: tab được ghim (hiển thị đầu thanh tab).
    pub pinned: bool,
    /// M5: tên nhóm tab; None là không thuộc nhóm nào.
    pub group: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatePayload {
    pub tabs: Vec<TabInfo>,
    pub active_tab: Option<u32>,
    /// M4: cửa sổ đang ở chế độ riêng tư (không ghi lịch sử).
    pub private: bool,
}
