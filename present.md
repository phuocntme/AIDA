# AIDA: Check Before You Pay — Master Context Prompt & Pitching Script (v2 · Max 3 Minutes)

Tài liệu được cập nhật theo kiến trúc mới nhất của dự án **AIDA** (`AgentPolicy` + `PaidReviews` + **Canonical ERC-8004** + **Chainlink** + **Avalanche Data API**), thông tin tác giả **`phuocntme`** (`https://github.com/phuocntme/AIDA`).

---

## PHẦN 1: MASTER PROMPT CHO AI AGENT (FULL PROJECT CONTEXT v2)

Copy toàn bộ khối dưới đây để giao cho AI Agent tạo/tinh chỉnh slide deck, kịch bản pitching ≤ 3 phút, hoặc trả lời ban giám khảo:

````markdown
# ROLE & GOAL
Bạn là Technical Presenter chuẩn bị bài pitching **tối đa 3 phút (180 giây)** cho dự án **AIDA — Check before you pay (Agent IDentity on Avalanche)** tại **Team1 Vietnam UniHack 2026** của **phuocntme** (`https://github.com/phuocntme/AIDA`).

Dựa trên **100% ngữ cảnh mã nguồn thực tế (v2)** dưới đây, hãy viết kịch bản pitching mạch lạc, sắc bén (~390–430 từ tiếng Việt, tốc độ nói ~140 từ/phút), làm nổi bật cả **chống chi tiêu độc hại on-chain (`AgentPolicy`)**, **chống review giả bằng thanh toán & Chainlink (`PaidReviews`)**, và **kịch bản demo trực quan (Run / Attack / Kill switch)**.

---

# FULL PROJECT CONTEXT (VERIFIED FROM v2 CODEBASE)

## 1. Tổng quan & Định vị
- **Tên dự án**: **AIDA — Check before you pay** (*Agent IDentity on Avalanche*)
- **Tác giả / Repo**: **phuocntme** · `https://github.com/phuocntme/AIDA` · Team1 Vietnam UniHack 2026
- **Vị trí đề tài**: Giao thoa giữa **#12 (Agent treasury with guardrails)** và **#17 (x402 payment rails)**.
- **Thông điệp cốt lõi**: *"AI Agent có ví tiền có thể bị lừa trả cho bất kỳ ai; và điểm uy tín trên ERC-8004 hiện có thể bị spam miễn phí. AIDA giới hạn những gì Agent được phép chi, buộc mỗi review phải gắn với một giao dịch thật, và để chính Smart Contract đọc Chainlink chấm điểm."*

## 2. Hai bài toán cốt lõi (The Problem)
1. **Rủi ro chi tiêu của Buyer Agent**: Khi một Agent nắm private key tự trả tiền (x402), lỗi code hoặc **Prompt Injection** có thể khiến bot chuyển hết quỹ cho ví lạ hoặc chi vượt mức. Rào chắn off-chain trong prompt/code của bot dễ dàng bị qua mặt nếu bot bị tấn công.
2. **Review rác & Sybil trên ERC-8004**: Trên các registry ERC-8004 thuần túy (Ethereum, BSC, Base), bất kỳ địa chỉ nào (trừ owner) đều có thể gọi `giveFeedback` miễn phí với điểm tự chọn — nghiên cứu *Xiong et al., 2026* chỉ ra 59–91% reviewer có dấu hiệu Sybil và đánh giá không gắn với giao dịch thật.

## 3. Kiến trúc Smart Contracts (Avalanche Fuji `43113` — Verified trên Routescan/Snowtrace)
AIDA sử dụng trực tiếp **Canonical ERC-8004 Registries** trên Avalanche Fuji (không tự deploy lại) và triển khai thêm 3 Smart Contract không chủ sở hữu, không nâng cấp (immutable, non-custodial):
1. **Canonical ERC-8004 Registries & Chainlink (trên Fuji)**:
   - **Identity Registry (v2.0.0)**: `0x8004A818BFB912233c491871b3d84c89A494BD9e` (lưu `ownerOf`, `tokenURI`; 5 agent giữ token `#308`–`#312`).
   - **Reputation Registry**: `0x8004B663056A597Dffe9eCcC1965A193B7388713` (nhận bản sao mọi review từ AIDA với client là `PaidReviews`).
   - **Chainlink AVAX/USD Feed**: `0x5498BB86BC934c8D34FDA08E81D444153d0D06aD`.
2. **`AgentPolicy.sol`** (`0x14ed319980c2af6840ab4969249147a6dd677a86`):
   - Mỗi Agent gắn với 1 Policy riêng do con người (**Guardian**) kiểm soát.
   - Rào chắn on-chain trong `pay(agentId, to, amount, ref)`:
     - Kiểm tra `msg.sender == p.agent && identity.ownerOf(agentId) == msg.sender` (nếu NFT bị bán/chuyển, tiền tự đóng băng tới khi Guardian gọi `rebindAgent`).
     - **Kill switch (`setPaused`)**: Guardian hoặc **Operator** (key chỉ có quyền pause/resume, không thể rút tiền hay đổi hạn mức) có thể khóa khẩn cấp.
     - **Whitelist (`isAllowed`)**, **Per-payment cap**, **Daily cap** (reset theo ngày UTC), số dư ký quỹ (`balance`), chống replay `ref` (`RefUsed`), `nonReentrant`.
     - Chỉ Guardian mới được `withdraw`, và chỉ rút về chính ví Guardian.
3. **`PaidReviews.sol`** (`0x39e53fc226d97b28fdc826bb413169abbb80f548`):
   - **1 thanh toán = 1 review**: Gọi `policy.consumeForReview(ref)` xác minh tiền đã đi qua `AgentPolicy` tới đúng ví chủ Agent bán, chưa từng được review (`AlreadyReviewed`), và chặn tự đánh giá (`SelfReview`).
   - **Chấm điểm khách quan qua Chainlink (`reviewQuote`)**: Seller ký EIP-191 (`quoteDigest`) lên báo giá & thời gian (`MAX_QUOTE_AGE = 10 phút`); Contract xác minh chữ ký của người bán, đọc thẳng `Chainlink.latestRoundData()` (`MAX_FEED_AGE = 1 giờ`), tự tính điểm `100 - 12 điểm / 1% sai lệch`, rồi tự động mirror bản sao vào Canonical ERC-8004 Reputation Registry (bọc `try/catch` để lỗi bên ngoài không chặn AIDA).
4. **`ValidationRegistry.sol`** (`0x01f397aedc0b80fd40434f4413ee43e51b633b7d`):
   - Chủ Agent chỉ định Validator độc lập kiểm tra job; Validator trả lời đúng 1 lần với điểm `0–100`.

## 4. Giao thức x402-style nâng cấp & Mạng lưới 5 Agent (`:8790–8794`)
- **Xác thực người gọi (`X-Agent-Auth`)**: Caller ký `personal_sign` lên `(chainId, agentId, sellerOrigin, path, timestamp ±120s, nonce)` — chống giả mạo Agent ID và chống làm ngập slot challenge (`401`, giới hạn 60 req/phút với request chưa ký, tối đa 8 open challenge/agent).
- **Chống lách Policy (`verifyPolicyPayment`)**: Seller kiểm tra sự kiện `Paid` trên `AgentPolicy`. Nếu caller có Policy nhưng cố tình chuyển thẳng bằng ví ngoài để né hạn mức, Seller từ chối phục vụ.
- **Cold-start an toàn (`guardedNewcomerOk`)**: Trust Oracle (`#308`, `0.001 AVAX`) phục vụ agent có trust `>= 60`, hoặc agent mới (`0` review) nếu Policy của nó có số dư đủ trả và thuộc Guardian mà Oracle tin cậy.
- **5 Agent thật trên Fuji (`deployments/43113.json`)**:
  - `#308` **AIDA Trust Oracle** (`:8790`)
  - `#309` **AVAX Price Pro** (`:8791`, `0.0005 AVAX`, trung vị Binance + CoinGecko)
  - `#310` **FastQuote** (`:8792`, `0.0005 AVAX`, cố tình trả cache cũ lệch 4–9%)
  - `#311` **AIDA Audit Lab** (`:8793`, validator kiểm định Price Pro với Chainlink)
  - `#312` **Treasury Bot** (`:8794`, rule engine thuần: `chooseSeller`, `checkPayment`, `parseSignedQuote` — **không LLM nào quyết định hay ký giao dịch tiền**).

## 5. Web App, Avalanche Data API & Read-only MCP
- **Web App (`packages/web`)**: Trang `Agents` (`/#/` với biểu đồ Trust Terrain & Ticker chạy liên tục), `Economy` (`/#/economy`), `Profile` (`/#/agent/:id`), `Register` (`/#/register`).
- **Avalanche Data API (`Ledger.tsx`)**: Trên Fuji, gọi `glacier-api.avax.network` liệt kê mọi giao dịch gửi vào `AgentPolicy` — **hiển thị được cả các giao dịch tấn công bị `revert` on-chain** (vốn không phát event log).
- **MCP Server (`packages/mcp`)**: Hoàn toàn **read-only** (`aida_search_agents`, `aida_get_agent`, `aida_check_trust`, `aida_check_payment` mô phỏng `eth_call` qua `AgentPolicy`), không giữ private key.

## 6. Kết quả đo thực tế trên Fuji & Bộ kiểm thử (131+ tests)
- **Tốc độ & Gas đo ngày 19 Nov 2026 trên Fuji**: Giao dịch `pay` vào block sau **~1.0 s** (`1.24 s/block`), xác nhận sau **2.3–3.7 s**, tốn **~95,625 gas** (`< 0.000001 AVAX` trên Fuji; hoặc ~0.00072 AVAX trên C-Chain mainnet 7.5 gwei → giao dịch sub-cent cần Avalanche L1 riêng với ICM, đã thiết kế kiến trúc trong `docs/ARCHITECTURE.md`).
- **Kiểm thử (131 tests + 1 opt-in Fuji fork test)**: Foundry `35 tests` (AgentPolicy 19, PaidReviews 16 incl. fuzz), Hardhat `10 tests`, SDK `30 tests`, Agent `46 tests` (45+1), MCP `4 tests`, Web demo-signer `6 tests`.
- **Giới hạn hiện tại**: 2 ví cùng 1 chủ vẫn có thể tự trả tiền thật cho nhau thông qua Policy (cần đếm distinct payers / trọng số), chưa có USDC EIP-3009 facilitator (để tiền đi qua `AgentPolicy`), agent chạy localhost trên máy demo.

---

# OUTPUT REQUIREMENT
Xuất kịch bản pitching **tối đa 3 phút (180 giây)** theo bảng `Slide / Thời gian | Màn hình / Thao tác Demo | Lời thoại (Voice-over)`, tập trung vào 3 cảnh Demo ăn tiền trên trang **Economy**: **Run**, **Attack**, và **Kill switch**.
````

---

## PHẦN 2: OUTLINE SLIDES & KỊCH BẢN PITCHING TỐI ĐA 3 PHÚT (v2)

* **Thời lượng mục tiêu**: **2 phút 45 giây** (tối đa 3:00 — chừa 15 giây dự phòng chuyển cảnh).
* **Nhịp độ**: ~140 từ/phút, nhấn mạnh vào **AgentPolicy**, **PaidReviews + Chainlink**, **Run / Attack / Kill switch**, **131 tests**, và **Avalanche Fuji**.

| Slide / Thời gian | Màn hình & Thao tác Demo | Lời thoại (Voice-over) |
|---|---|---|
| **1. Mở đầu**<br>`0:00 – 0:15`<br>*(15 giây)* | **Slide 1:** `AIDA: check before you pay` · *Agent IDentity on Avalanche* · `phuocntme · UniHack 2026` (nền Trust Terrain 5 agent). | *"Xin chào ban giám khảo, mình là **phuocntme** đến với **UniHack 2026**. Đây là **AIDA — Check before you pay**: hệ thống giúp AI Agent biết nên tin ai trước khi trả tiền, và giới hạn chính xác số tiền Agent được phép chi trên Avalanche."* |
| **2. Vấn đề**<br>`0:15 – 0:35`<br>*(20 giây)* | **Slide 2:** 2 lỗ hổng của Agent Economy: (1) Prompt injection / lỗi code rút cạn ví bot; (2) ERC-8004 review miễn phí (59–91% Sybil, *Xiong et al. 2026*). | *"Khi AI Agent tự giữ ví để mua dữ liệu qua x402, có hai rủi ro chí mạng: Thứ nhất, một lệnh prompt injection có thể lừa bot chuyển sạch tiền cho kẻ lạ hoặc chi vượt trần. Thứ hai, điểm uy tín ERC-8004 hiện cho phép bất kỳ ai viết review miễn phí mà không cần giao dịch thật — dẫn đến tình trạng Sybil tràn lan."* |
| **3. Giải pháp & Kiến trúc**<br>`0:35 – 1:00`<br>*(25 giây)* | **Slide 3 / Sơ đồ Kiến trúc:** Canonical ERC-8004 (`#308–#312`) + **3 Contracts**: `AgentPolicy` · `PaidReviews` (+ Chainlink) · `ValidationRegistry`. | *"AIDA giải quyết tận gốc bằng cách gắn thẳng trên **Canonical ERC-8004 Registries** của Avalanche Fuji với 3 smart contract: Một là **AgentPolicy** giữ quỹ của bot với hạn mức ngày, trần mỗi lệnh, whitelist và công tắc ngắt **Kill switch** do con người nắm. Hai là **PaidReviews**: bắt buộc **1 thanh toán mới được 1 review**; riêng báo giá, chính contract đọc **Chainlink** để tự tính điểm, không ai bịa được. Ba là **ValidationRegistry** cho kiểm định độc lập."* |
| **4. Demo: Paid Job (`Run`)**<br>`1:00 – 1:35`<br>*(35 giây)* | **Web (`/#/economy`):**<br>1. Chỉ thẻ **AgentPolicy** (`daily cap`, `per payment ≤ 0.002`, `whitelist`).<br>2. Bấm **Run** → log: `Skipped FastQuote` → `Paid 0.0005 AVAX` → `Score 97` → mở link **tx ↗** trên Snowtrace. | *"Hãy xem luồng chạy thật trên Avalanche Fuji tại trang **Economy**. **Treasury Bot** chỉ được chi qua hợp đồng **AgentPolicy** này. Khi bấm **Run**, bot tự động bỏ qua **FastQuote** vì điểm uy tín kém, thuê **AVAX Price Pro** và trả `0.0005 AVAX` qua policy — giao dịch vào block chỉ trong khoảng 1 giây. Ngay sau đó, `PaidReviews` đối chiếu báo giá đã ký của người bán với **Chainlink**, chấm **97 điểm** on-chain và tự đồng bộ vào ERC-8004."* |
| **5. Demo: `Attack` & `Kill switch`**<br>`1:35 – 2:15`<br>*(40 giây)* | **Web (`/#/economy`):**<br>1. Bấm **Attack** → hiện 2 lệnh bị chặn: `RecipientNotAllowed` & `OverPerPaymentCap`, bảng **Policy transactions** hiện dòng đỏ `Payment reverted`.<br>2. Chọn ví Guardian/Operator → bấm **Kill switch** (`PAUSED`) → bấm **Run** bị `AgentPaused`. | *"Điều gì xảy ra nếu bot bị tấn công? Khi mình bấm **Attack**, hệ thống bơm hai lệnh độc hại: trả ví lạ ngoài whitelist và chi gấp 25 lần hạn mức. Luật của bot từ chối trước; và ngay cả khi giả định code bot bị hack để bắn thẳng transaction lên mạng, **AgentPolicy** vẫn **revert cả hai trên chuỗi** — không mất một wei nào, và **Avalanche Data API** hiển thị nguyên trạng 2 giao dịch revert này. Cuối cùng, con người chỉ cần bấm **Kill switch**, hợp đồng lập tức đóng băng mọi chi tiêu tiếp theo."* |
| **6. Vì sao Avalanche, Bảo mật & Roadmap**<br>`2:15 – 2:50`<br>*(35 giây)* | **Slide Proof & Tech:**<br>• **Avalanche**: Canonical ERC-8004, Chainlink, Data API; ~1s block, `95,625 gas/pay`<br>• **Bảo mật**: `X-Agent-Auth`, không LLM nào giữ key, **131 tests** (incl. Foundry fuzz & Fuji fork)<br>• **Limits & Next**: L1 riêng + ICM cho sub-cent, USDC x402, đếm distinct payers<br>• **CTA**: `https://github.com/phuocntme/AIDA` | *"Avalanche hội tụ đủ mảnh ghép: Canonical ERC-8004, Chainlink, Data API và tốc độ xác nhận vài giây với phí dưới `0.000001 AVAX` trên Fuji. Toàn bộ hệ thống không để bất kỳ LLM nào chạm vào tiền, bảo vệ request bằng chữ ký `X-Agent-Auth`, và đi kèm **131 bài test tự động** gồm cả Foundry fuzz và Fuji fork test. Sắp tới tụi mình sẽ hỗ trợ USDC facilitator qua policy, đếm trọng số theo số người trả khác nhau và mở rộng sang một **Avalanche L1 riêng** cho thanh toán dưới 1 cent. Mã nguồn mở tại `github.com/phuocntme/AIDA`. Cảm ơn ban giám khảo!"* |

---

### Q&A dự phòng nhanh (Chuẩn bị theo Threat Model v2)
1. **Hỏi: Tại sao lại mua báo giá qua x402 khi có thể đọc thẳng Chainlink miễn phí?**
   - *Trả lời*: Chainlink AVAX/USD trên Fuji chỉ cập nhật mỗi 600 giây hoặc khi giá lệch 1%, nên không phản ánh giá tức thời lúc bot cần giao dịch. Bot mua báo giá live (Binance + CoinGecko median), còn Chainlink được contract dùng làm dải kiểm chứng rộng phía sau để chấm điểm khách quan.
2. **Hỏi: Một người dùng 2 ví tự trả tiền cho nhau qua `AgentPolicy` để cày điểm được không?**
   - *Trả lời*: Hai ví cùng chủ có thể trả tiền thật cho nhau để ghi review, nhưng với báo giá, họ **không thể tự chọn điểm** vì `PaidReviews` tự tính điểm từ Chainlink, và mỗi review đều phải tốn phí thật đi qua Policy. Người đọc có thể lọc theo số lượng người trả tiền khác nhau (distinct payers).
3. **Hỏi: Làm sao chống giả mạo `X-Agent-Id` để dùng chùa uy tín của agent khác hoặc spam slot 402?**
   - *Trả lời*: Mọi request phải ký `X-Agent-Auth` (`personal_sign` bằng ví `ownerOf(agentId)` gắn origin, path, timestamp ±120s, nonce dùng 1 lần). Request không chữ ký trả `401` ngay và bị rate-limit theo IP.
