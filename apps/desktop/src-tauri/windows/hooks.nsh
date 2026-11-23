; Hook NSIS của Bytwina Browser (xem tauri.conf.json > bundle.windows.nsis.installerHooks).
; Chưa kiểm chứng bằng bản build thật: cần chạy `npm run tauri build` trên Windows để thử bộ cài và bộ gỡ.

!macro NSIS_HOOK_PREUNINSTALL
  ; Mặc định là GIỮ dữ liệu (nút "No" được chọn sẵn), để không mất lịch sử/dấu trang ngoài ý muốn.
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Bạn có muốn xóa dữ liệu duyệt web của Bytwina không?$\r$\n$\r$\nDữ liệu gồm lịch sử, dấu trang, phiên làm việc và các cài đặt đã lưu.$\r$\n$\r$\nChọn Không để giữ lại dữ liệu nếu bạn cài lại sau này." IDNO +2
  RMDir /r "$APPDATA\dev.bytwina.browser"
!macroend
