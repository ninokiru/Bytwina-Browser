import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
// Sau styles.css để các luật thiết kế bổ sung thắng khi cùng độ ưu tiên.
import "./design.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
