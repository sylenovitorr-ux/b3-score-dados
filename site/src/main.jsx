import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./runtime-autoupdate.js";
import "./styles.css";
import "./v2.css";
import "./model-validation.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
