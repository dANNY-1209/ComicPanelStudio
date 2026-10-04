<p align="center"><img src="assets/logo.svg" width="96" alt=""></p>

<h1 align="center">漫畫分格工作室 · Comic Panel Studio</h1>

<p align="center">在瀏覽器裡排漫畫頁：分格、放圖、對話框、直書、封面與匯出，一個網頁就搞定。<br>
A browser-based comic / manga page layout tool — panels, images, speech bubbles, vertical text, covers and export.</p>

---

## 中文說明

### 特色
- **分格**：20 種分格模板（含斜切格）、單一格子形狀、刀切工具（拖一條線就能切出斜格）、拖曳頂點自由變形。
- **版面樣式**：一般／滿版細縫／滿版無縫／滿版分隔線一鍵切換；手動改過的格子也會自動調整，刻意留白的地方保持不動。
- **圖片**：直接把圖片拖進格子（一次拖多張會依序填入）、雙擊調整裁切位置與縮放，靠近格子邊緣會自動貼齊避免露白。
- **三個圖層**：下層、上層、文字層；封面／封底／插頁使用「底圖＋文字層」兩層格式。
- **對話框**：8 種形狀可隨時切換，尾巴可加多條、可拉彎；文字可直書或橫書、自動換行、直書換列方向可往左或往右，半形英數自動縱中橫或側躺。
- **文字特效**：14 種一鍵樣式（熱血、霓虹、黃金…），漸層、雙層描邊、陰影光暈、立體、斜體、拱形、波浪。
- **貼圖**：愛心、漫符、18 禁標誌、封面元素、集中線等；內建素材皆為 CC0。
- **封面與封底**：16 款模板（單行本、同人誌、書腰、雜誌風、版權頁…）。
- **對齊吸附**：拖曳時邊緣與中心自動對齊並顯示參考線，旋轉接近 90° 倍數時吸附。
- **跨頁複製**：Ctrl+C／Ctrl+V 跨頁貼上，或一次複製到多頁。
- **預覽**：全螢幕黑底，所有頁面由上往下捲動閱讀。
- **雙語介面**：繁體中文／English。

### 開始使用
不需要安裝任何東西。

1. 下載這個專案（綠色 **Code** 按鈕 → **Download ZIP**），解壓縮。
2. 用 **Chrome** 或 **Edge** 開啟 `index.html`。

> 建議使用 Chrome 或 Edge：「存成資料夾」與「匯出到資料夾」需要瀏覽器的檔案系統功能。其他瀏覽器仍可使用，但存檔會改成下載單一 `.json` 檔。
> 字體從 Google Fonts 載入，使用時需要網路。

### 存檔與匯出
- **自動暫存**：作品會自動暫存在瀏覽器裡，關掉再開還在。
- **專案資料夾**：「檔案 → 另存新檔」會存成一個資料夾：`project.json`（排版資料）＋ `images/`（圖片）＋ `fonts/`（匯入的字體）。方便備份、換電腦。
- **匯出**：PDF（所有頁合成一份），或 PNG／JPG 圖片資料夾，可選 1～3 倍解析度。

### 常用快捷鍵
| 按鍵 | 功能 |
|---|---|
| `V` / `K` | 選取工具 / 刀切工具 |
| `L` | 切換圖層 |
| `P` | 全螢幕預覽 |
| `Enter`（選取有圖的格子） | 調整圖片 |
| `Ctrl+C` / `Ctrl+X` / `Ctrl+V` | 複製 / 剪下 / 貼上（可跨頁） |
| `Ctrl+D` | 在同一頁複製 |
| `Ctrl+Z` / `Ctrl+Y` | 復原 / 重做 |
| `Ctrl+S` / `Ctrl+Shift+S` | 儲存 / 另存新檔 |
| `Ctrl+E` | 匯出 |
| `Alt`（拖曳中） | 暫時關閉吸附 |
| `Shift`（旋轉中） | 每 15° 一格 |
| 空白鍵＋拖曳、`Ctrl`＋滾輪 | 移動畫面、縮放畫面 |

---

## English

### Features
- **Panels** — 20 layout templates (including slanted cuts), single panel shapes, a knife tool to cut panels by dragging a line, free vertex editing.
- **Page styles** — normal / bleed with thin gaps / seamless bleed / bleed with divider lines; hand-edited panels adapt automatically while intentional empty space is kept.
- **Images** — drop images onto panels (several at once fill the following empty panels), double-click to adjust crop and zoom, edges snap to panel borders to avoid white gaps.
- **Three layers** — bottom, top and a text layer; cover / back cover / insert pages use a two-layer format.
- **Speech bubbles** — 8 switchable shapes, multiple bendable tails, horizontal or vertical text with auto wrap, leftward or rightward column order, tate-chū-yoko for half-width characters.
- **Text effects** — 14 one-click styles plus gradients, double outlines, shadow / glow, 3D extrude, slant, arch and wave.
- **Stickers** — hearts, manga symbols, age-rating marks, cover elements, focus lines; bundled clip art is CC0.
- **Covers** — 16 front / back cover templates.
- **Smart snapping** — edge and center alignment with guide lines while dragging; rotation snaps near multiples of 90°.
- **Copy across pages**, **full-screen scroll preview**, **Traditional Chinese / English UI**.

### Getting started
Nothing to install: download the repository (**Code → Download ZIP**), unzip it and open `index.html` in **Chrome** or **Edge**.
Chrome / Edge are recommended because saving to and exporting into folders uses the File System Access API; other browsers fall back to downloading a single `.json` project file. Fonts are loaded from Google Fonts, so an internet connection is needed.

### Saving and exporting
Work is auto-cached in the browser. **File → Save As** writes a project folder (`project.json` + `images/` + `fonts/`). Export to a single PDF, or to a folder of PNG / JPG pages at 1×–3×.

---

## 素材與字體授權 · Assets and fonts
- **內建貼圖素材**來自 [Openclipart](https://openclipart.org/)，全部為 **CC0 1.0（公眾領域）**：可商用、可修改、不需標註。來源清單見 [`assets/CREDITS.md`](assets/CREDITS.md)。
  Bundled clip art comes from Openclipart and is **CC0 1.0 (public domain)**. See `assets/CREDITS.md` for sources.
- **內建字體**（37 款）由 Google Fonts 提供，授權為 **SIL Open Font License** 或 **Apache 2.0**：作品中使用不需標註字體作者。
  The 37 built-in fonts are served by Google Fonts under the **SIL OFL** or **Apache 2.0**; no credit is required in your artwork.
- 你自行匯入的字體與圖片，請自行確認授權。Make sure fonts and images you import yourself are licensed for your use.
- 年齡標示為通用設計樣式；正式販售時請依當地法規與通路規定標示。Age-rating marks are generic designs; follow local rules when selling.

## 授權 · License
程式碼以 [MIT License](LICENSE) 釋出。The code is released under the [MIT License](LICENSE).
