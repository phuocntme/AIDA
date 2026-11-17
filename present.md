# AIDA — Master Context Prompt & Pitching Script (Chuẩn 8 Slide · Tối đa 3 Phút)

Tài liệu được dựng lại bám sát khung chuẩn **8 Slide** cho cuộc thi **UniHack 2026**, gồm 2 phần:
1. **Phần 1 — Master Prompt cho AI Agent**: Nạp trọn vẹn ngữ cảnh kỹ thuật từ mã nguồn dự án **AIDA** xoay quanh đúng 8 mục chuẩn để AI Agent sinh/tinh chỉnh bài pitch 3 phút chính xác.
2. **Phần 2 — Outline 8 Slides & Kịch bản Pitching hoàn chỉnh (≤ 3 phút)**: Bám sát từng slide, từng ý chuẩn kèm lời thoại thuyết trình, thao tác màn hình demo và Q&A dự phòng.

---

## PHẦN 1: MASTER PROMPT CHO AI AGENT (8-SLIDE PITCH GENERATOR)

Copy toàn bộ khối prompt dưới đây để giao cho AI Agent:

````markdown
# ROLE & GOAL
Bạn là Technical Presenter chuẩn bị bài pitching **tối đa 3 phút (180 giây)** cho dự án **AIDA — Agent IDentity on Avalanche** tại **UniHack 2026**.

Hãy bám sát **chính xác khung chuẩn 8 Slide** và **ngữ cảnh mã nguồn thực tế** dưới đây để viết kịch bản thuyết trình mạch lạc, súc tích, đúng thời lượng (~380–420 từ tiếng Việt, tốc độ nói tự nhiên ~135–145 từ/phút). Không tự ý bỏ bớt hoặc đổi thứ tự 8 slide chuẩn.

---

# KHUNG CHUẨN 8 SLIDE BẮT BUỘC

1. **Slide 1 — AIDA — Agent IDentity on Avalanche.**
   - Tagline: *"Hộ chiếu và điểm uy tín on-chain cho AI agent."*
   - phuocntme, UniHack 2026.
2. **Slide 2 — Vấn đề.**
   - Năm 2026 AI agent tự gọi API, tự trả tiền cho nhau (x402).
   - Nhưng agent không biết bên kia là ai và có đáng tin không: spam bot, agent lừa đảo, agent kém chất lượng đều trông giống nhau.
3. **Slide 3 — Giải pháp.**
   - Registry danh tính + uy tín theo chuẩn **ERC-8004** trên Avalanche:
     (1) NFT passport + agent card,
     (2) khách hàng chấm điểm on-chain,
     (3) dịch vụ trả phí kiểm tra AIDA trước khi nhận tiền.
4. **Slide 4 — Demo flow (screenshot / live).**
   - `SpamBot` bị **403** → `TranslatorVN` nhận **402** → trả **0.01 AVAX** → **200** + báo cáo → chấm điểm Oracle.
5. **Slide 5 — Kiến trúc.**
   - 2 smart contract (`IdentityRegistry` ERC-721, `ReputationRegistry`) · SDK TypeScript · Trust Oracle x402 · Web app.
   - Chạy local Hardhat và Fuji C-Chain.
6. **Slide 6 — Vì sao Avalanche.**
   - Phí rẻ + finality < 2s, phù hợp micro-payment giữa agent.
   - EVM nên dùng thẳng ERC-8004.
   - Hướng tới L1 riêng cho traffic agent.
7. **Slide 7 — Bảo mật & kiểm thử.**
   - **34 test tự động**.
   - Thanh toán gắn với challenge bằng `keccak(nonce)`, chống replay và double-spend, chủ agent không được tự chấm.
   - Giới hạn hiện tại: chưa chống Sybil.
8. **Slide 8 — Roadmap.**
   - Validation Registry, feedback có chữ ký, chấm điểm có trọng số, USDC qua facilitator x402 chính thức, L1 riêng.
   - CTA: link repo.

---

# NGỮ CẢNH KỸ THUẬT CHI TIẾT TỪ MÃ NGUỒN (VERIFIED CONTEXT)

## 1. Smart Contracts (`packages/contracts/contracts/`, Solidity `0.8.28`, Hardhat 3 + OpenZeppelin)
- **`IdentityRegistry.sol`** (`ERC721URIStorage`, name `"AIDA Agent Identity"`, symbol `"AIDA"`):
  - Mỗi agent gọi `register(agentURI)` để mint 1 ERC-721 passport với `agentId` tăng dần.
  - `tokenURI` lưu Agent Card JSON chuẩn ERC-8004 dạng `data:application/json;base64,...`.
  - Hỗ trợ cập nhật URI (`setAgentURI` — chỉ `ownerOf(agentId)` được gọi), kiểm tra tồn tại (`exists`), tổng số agent (`totalAgents`).
- **`ReputationRegistry.sol`**:
  - Khách hàng gọi `giveFeedback(agentId, score, tag, uri)` với `score` từ `0–100`, `tag` (`bytes32`), và `uri` bằng chứng.
  - Ràng buộc on-chain:
    - Chặn tự chấm điểm: `if (identity.ownerOf(agentId) == msg.sender) revert SelfFeedback(agentId);`
    - Kiểm tra agent tồn tại (`AgentNotFound`) và điểm hợp lệ `0–100` (`ScoreOutOfRange`).
  - Cung cấp `getSummary(agentId) -> (count, average)` và `getFeedback(agentId)` minh bạch cho mọi người đọc.
- **Mạng hỗ trợ**:
  - Local Hardhat (`chainId: 31337`, RPC `http://127.0.0.1:8545`).
  - Avalanche Fuji C-Chain (`chainId: 43113`, `deployments/43113.json`: `IdentityRegistry` `0x11eae62a2097fc218f7f2832626caa1744c69a46`, `ReputationRegistry` `0x0521900b337617873e12601ae2b3a71a3589e2a5`).

## 2. TypeScript SDK (`packages/sdk/src/`, `viem`)
- **`card.ts`**: Định nghĩa và validate Agent Card chuẩn `https://eips.ethereum.org/EIPS/eip-8004#registration-v1` (gồm `type`, `name` 1–64 ký tự, `description` <= 500 ký tự, `endpoints` http(s), `wallet` 0x40 hex, `image` tùy chọn), cùng `encodeCardURI` / `decodeCardURI`.
- **`client.ts`**: `AidaClient` đọc/ghi hợp đồng (`register`, `giveFeedback`, `summary`, `feedback`, `resolve`, `list`, `activity`).
- **`x402.ts`**: Hiện thực hóa luồng HTTP 402 trả phí bằng native AVAX:
  - `gateByReputation(summary, minScore)`: kiểm tra agent có review chưa và `average >= minScore` (mặc định `60`).
  - `nonceToData(nonce)`: băm `keccak256(stringToBytes(nonce))` để đặt vào `calldata` của giao dịch AVAX. Nonce gốc chỉ truyền qua HTTP, không lộ trên mempool/chain → gắn chặt thanh toán vào đúng 1 challenge và chống người khác cướp tx.
  - `verifyPayment`: kiểm tra `usedTx` và `nonce` khớp challenge; **khóa `txHash` vào `usedTx` trước `await`** (nhả lại nếu fail) để chống concurrent double-spend; đối chiếu on-chain `receipt.status === "success"`, `tx.to === req.payTo`, `tx.value >= maxAmountRequired`, `tx.from === caller.owner`, `tx.input === nonceToData(nonce)`.
  - `callPaidAgent`: tự động chạy chu trình `GET -> 402 -> pay -> retry với X-PAYMENT`.

## 3. Trust Oracle x402 (`packages/agent/src/`)
- **`paid.ts` (`createPaidRoute`)** & **`oracle.ts` (`createOracle`)**:
  - Endpoint `GET /report/:agentId` (mặc định chạy ở `:8787` khi demo local) bán báo cáo độ tin cậy của một agent (`verdict`: `unknown` / `trusted` >= 80 / `ok` >= 60 / `risky` < 60).
  - Yêu cầu header `X-Agent-Id`. Tra cứu danh tính và điểm uy tín caller trên AIDA:
    - Nếu điểm `< 60` (hoặc chưa có review): trả **`403 Forbidden`** ngay lập tức (`caller reputation too low`), chưa thu bất kỳ đồng nào.
    - Nếu đạt `>= 60` và chưa có header `X-PAYMENT`: trả **`402 Payment Required`** kèm `x402Version: 1`, `accepts: [{ payTo, maxAmountRequired: 0.01 AVAX, nonce, ... }]` (TTL 10 phút).
    - Khi caller gửi lại kèm `X-PAYMENT` (`base64(JSON({txHash, nonce}))`): xác thực giao dịch on-chain → trả **`200 OK`** + báo cáo + header `X-PAYMENT-RESPONSE`.

## 4. Web App & Demo Flow (`packages/web/`, `scripts/demo.sh`, `scripts/e2e.sh`)
- **Chạy demo local bằng 1 lệnh**: `pnpm demo` (khởi động Hardhat node + deploy + seed các agent mẫu + Trust Oracle `:8787` + Web App `http://127.0.0.1:5180`).
- **Nhân vật seed mặc định**:
  - Agent `#1` **TranslatorVN**: 90 điểm uy tín (review 92 & 88) → **Trusted**.
  - Agent `#2` **SpamBot 9000**: 20 điểm uy tín (review 15 & 25, tag `"spam"`) → **Risky**.
  - Agent `#3` **AIDA Trust Oracle**: 80 điểm uy tín, bán report giá `0.01 AVAX`, ngưỡng `minScore = 60`.
- **Luồng demo chính**:
  1. Đóng vai **SpamBot 9000 (#2)** bấm *Buy report* → trả **`403 Refused: reputation 20 < 60`**.
  2. Đóng vai **TranslatorVN (#1)** bấm *Buy report* → nhận **`402 Payment Required`** → trả **`0.01 AVAX`** (kèm `keccak(nonce)` trong calldata) → nhận **`200 OK` + báo cáo** → chấm điểm Oracle **95/100** trực tiếp on-chain → điểm Oracle tăng trên trang Home.
  3. CLI tương đương qua `pnpm e2e` chứng minh flow chạy được hoàn toàn không cần UI.

## 5. Bảo mật, Kiểm thử & Roadmap
- **Kiểm thử**: `pnpm test` chạy bộ **34 test tự động** (trong tài liệu pitch gốc: contracts, sdk, agent, cùng E2E `pnpm e2e`).
- **Bảo mật**:
  - Thanh toán gắn challenge `keccak(nonce)` chống replay và mempool front-running.
  - Khóa `txHash` trước khi `await` chống double-spend đồng thời; kiểm tra `tx.from == caller.owner`.
  - Smart contract chặn chủ sở hữu tự chấm điểm (`SelfFeedback`).
  - **Giới hạn hiện tại**: chưa chống Sybil (một người có thể tạo nhiều ví để tự đánh giá).
- **Roadmap**:
  - **Validation Registry** (xác thực job bởi validator độc lập), feedback có chữ ký ủy quyền (`feedbackAuth`), chấm điểm có trọng số theo uy tín của chính người chấm (chống Sybil), thanh toán **USDC (EIP-3009)** qua x402 facilitator chính thức, và triển khai **Avalanche L1 riêng** cho traffic agent.

---

# OUTPUT REQUIREMENT
Xuất ra kịch bản thuyết trình tối đa **3 phút (180 giây)** chia theo đúng **8 Slide chuẩn**:
- Bảng gồm các cột: `Slide / Thời gian | Nội dung Slide & Màn hình Demo | Lời thoại (Voice-over)`
- Tổng thời lượng phải `<= 180 giây`, ưu tiên phần Demo flow rõ ràng, dễ hình dung.
- Kèm ghi chú Q&A ngắn dựa trên đúng giới hạn và bảo mật đã nêu.
````

---

## PHẦN 2: OUTLINE 8 SLIDES & KỊCH BẢN PITCHING TỐI ĐA 3 PHÚT

* **Tổng thời lượng mục tiêu**: **2 phút 45 giây** (tối đa 3:00 — chừa 15 giây đệm chuyển slide / trả lời nhanh).
* **Tốc độ nói**: ~140 từ/phút, nhấn rõ các con số: **ERC-8004**, **403 / 402 / 0.01 AVAX / 200**, **finality < 2s**, **34 test tự động**.

### Tóm tắt phân bổ 8 Slide (≤ 3 phút)

| Slide | Chủ đề | Thời lượng | Mục tiêu |
|---|---|---|---|
| **Slide 1** | AIDA — Agent IDentity on Avalanche | `0:00 – 0:15` (15s) | Mở đầu ấn tượng, nêu tagline & đội thi. |
| **Slide 2** | Vấn đề | `0:15 – 0:35` (20s) | Nêu nỗi đau mù mờ danh tính/uy tín khi agent trả tiền qua x402. |
| **Slide 3** | Giải pháp | `0:35 – 0:55` (20s) | 3 trụ cột ERC-8004 trên Avalanche. |
| **Slide 4** | Demo flow (Screenshot / Live) | `0:55 – 1:50` (55s) | Trọng tâm thuyết phục: SpamBot `403` vs TranslatorVN `402 → 0.01 AVAX → 200 → chấm Oracle`. |
| **Slide 5** | Kiến trúc | `1:50 – 2:10` (20s) | 2 contract, SDK TypeScript, Trust Oracle x402, Web app (Hardhat & Fuji). |
| **Slide 6** | Vì sao Avalanche | `2:10 – 2:25` (15s) | Phí rẻ, finality < 2s, tương thích EVM, hướng tới L1 riêng. |
| **Slide 7** | Bảo mật & kiểm thử | `2:25 – 2:40` (15s) | 34 test, `keccak(nonce)`, chống double-spend & tự chấm; thẳng thắn về Sybil. |
| **Slide 8** | Roadmap & CTA | `2:40 – 2:55` (15s) | Validation Registry, chữ ký, trọng số, USDC x402, L1 riêng & link repo. |

---

### Kịch bản thuyết trình chi tiết từng Slide

| Slide / Thời gian | Nội dung Slide & Màn hình Demo | Lời thoại (Voice-over) |
|---|---|---|
| **Slide 1**<br>`0:00 – 0:15`<br>*(15 giây)* | **Tiêu đề:** `AIDA — Agent IDentity on Avalanche`<br>**Tagline:** *"Hộ chiếu và điểm uy tín on-chain cho AI agent."*<br>**Footer:** `phuocntme · UniHack 2026`<br>*(Có thể kèm ảnh màn hình Home Hero của web app)* | *"Xin chào ban giám khảo, tụi mình là team **phuocntme** đến với **UniHack 2026**. Dự án của tụi mình là **AIDA — Agent IDentity on Avalanche**: hộ chiếu và điểm uy tín on-chain cho AI agent."* |
| **Slide 2**<br>`0:15 – 0:35`<br>*(20 giây)* | **Vấn đề:**<br>• AI agent năm 2026 tự gọi API, tự trả tiền qua **x402**<br>• Thiếu danh tính & uy tín on-chain<br>• Spam bot, agent lừa đảo, agent kém chất lượng đều trông giống nhau | *"Năm 2026, AI agent đã tự gọi API và tự trả tiền cho nhau qua giao thức **x402**. Nhưng vấn đề lớn là agent không hề biết bên kia là ai và có đáng tin không: trên mạng lưới, một spam bot, một agent lừa đảo hay một agent kém chất lượng đều trông giống hệt nhau."* |
| **Slide 3**<br>`0:35 – 0:55`<br>*(20 giây)* | **Giải pháp — ERC-8004 trên Avalanche:**<br>1. **NFT Passport + Agent Card** (ERC-721)<br>2. **Khách hàng chấm điểm on-chain** (0–100)<br>3. **Dịch vụ trả phí kiểm tra AIDA trước khi nhận tiền** | *"Giải pháp của tụi mình là xây dựng registry danh tính và uy tín theo chuẩn **ERC-8004** ngay trên Avalanche với 3 lớp: Thứ nhất, mỗi agent sở hữu một hộ chiếu NFT gắn Agent Card; Thứ hai, khách hàng chấm điểm minh bạch on-chain sau khi sử dụng; Và thứ ba, mọi dịch vụ trả phí đều kiểm tra điểm AIDA của người gọi trước khi nhận tiền."* |
| **Slide 4**<br>`0:55 – 1:50`<br>*(55 giây)* | **Demo flow (Screenshot hoặc Demo trực tiếp `pnpm demo`):**<br>1. Directory: **TranslatorVN (90)** vs **SpamBot 9000 (20)**.<br>2. Đóng vai **SpamBot** gọi Oracle → **`403 Refused: reputation 20 < 60`**.<br>3. Đóng vai **TranslatorVN** gọi Oracle → **`402`** → trả **`0.01 AVAX`** → **`200` + báo cáo** → chấm điểm Oracle **95/100**. | *"Đây là luồng demo thực tế trên AIDA: Trong danh bạ, **TranslatorVN** đang có 90 điểm uy tín, còn **SpamBot 9000** chỉ 20 điểm. Khi **SpamBot** gọi vào **Trust Oracle** để mua báo cáo, Oracle kiểm tra AIDA và từ chối ngay với mã **403** vì uy tín dưới 60 — không hề phát sinh giao dịch. Ngược lại, khi **TranslatorVN** gọi vào: Oracle trả **402 Payment Required**; agent tự thanh toán **0.01 AVAX**, gửi lại bằng chứng giao dịch, Oracle kiểm tra on-chain và trả về **200** cùng bản báo cáo đầy đủ. Xong việc, TranslatorVN chấm lại Oracle **95 điểm** on-chain, giúp uy tín của Oracle tăng ngay lập tức."* |
| **Slide 5**<br>`1:50 – 2:10`<br>*(20 giây)* | **Kiến trúc hệ thống:**<br>• **2 Smart Contracts:** `IdentityRegistry` (ERC-721), `ReputationRegistry`<br>• **SDK TypeScript** (`@aida/sdk`)<br>• **Trust Oracle x402** (`@aida/agent`)<br>• **Web App** (`@aida/web`)<br>• Chạy trên **Hardhat local** & **Avalanche Fuji C-Chain** | *"Về kiến trúc, AIDA gồm 2 smart contract cốt lõi là **IdentityRegistry** chuẩn ERC-721 và **ReputationRegistry**, đi kèm bộ **SDK TypeScript**, dịch vụ **Trust Oracle x402**, và **Web app** cho người dùng thao tác. Toàn bộ hệ thống chạy mượt từ **Hardhat local** cho đến mạng testnet **Avalanche Fuji C-Chain**."* |
| **Slide 6**<br>`2:10 – 2:25`<br>*(15 giây)* | **Vì sao Avalanche:**<br>• Phí rẻ + **finality < 2s** → hợp micro-payment giữa agent<br>• Tương thích **EVM** → dùng thẳng chuẩn **ERC-8004**<br>• Hướng tới **Avalanche L1 riêng** cho traffic agent | *"Tụi mình chọn Avalanche vì phí giao dịch rất rẻ và **finality dưới 2 giây** — yếu tố sống còn cho các vi thanh toán liên tục giữa các agent. Đồng thời Avalanche tương thích EVM nên triển khai thẳng được **ERC-8004**, và về dài hạn có thể tách thành một **Avalanche L1 riêng** chuyên phục vụ lưu lượng agent."* |
| **Slide 7**<br>`2:25 – 2:40`<br>*(15 giây)* | **Bảo mật & kiểm thử:**<br>• **34 test tự động** (`pnpm test` + `pnpm e2e`)<br>• Thanh toán gắn challenge bằng `keccak(nonce)`<br>• Chống **replay** & **double-spend**, chặn chủ agent tự chấm (`SelfFeedback`)<br>• *Giới hạn hiện tại:* chưa chống Sybil | *"Về bảo mật và kiểm thử, dự án có **34 bài test tự động**. Mọi giao dịch x402 đều gắn với challenge qua **`keccak(nonce)`** trên calldata để chống replay và double-spend; smart contract cũng khóa không cho chủ agent tự chấm điểm mình. Tụi mình cũng nhìn nhận thẳng giới hạn hiện tại là hệ thống chưa chống được Sybil."* |
| **Slide 8**<br>`2:40 – 2:55`<br>*(15 giây)* | **Roadmap & CTA:**<br>• **Validation Registry** (kiểm định độc lập)<br>• Feedback có chữ ký (`feedbackAuth`) + **chấm điểm có trọng số**<br>• **USDC** qua facilitator x402 chính thức<br>• **Avalanche L1 riêng**<br>• **CTA:** `https://github.com/phuocntme/AIDA` | *"Đó cũng là trọng tâm Roadmap tiếp theo của tụi mình: hoàn thiện **Validation Registry**, bổ sung feedback có chữ ký và chấm điểm có trọng số để giải quyết Sybil, hỗ trợ thanh toán **USDC** qua facilitator x402 chính thức, và triển khai **L1 riêng**. Mời ban giám khảo quét mã hoặc truy cập repo để xem chi tiết mã nguồn và bản demo. Cảm ơn mọi người đã lắng nghe!"* |

---

### Ghi chú nhanh trước khi lên trình bày & Q&A dự phòng

1. **Chuẩn bị trước giờ Pitch (nếu demo live trên Slide 4)**:
   - Chạy sẵn `pnpm demo` ở terminal để Web App sẵn sàng tại `http://127.0.0.1:5180` và mở sẵn 2 tab: Profile `#1` (để đóng vai SpamBot `#2`) và Profile `#2` (để đóng vai TranslatorVN `#1`), hoặc chuẩn bị ảnh screenshot rõ các mã `403`, `402`, `0.01 AVAX`, `200`, `95/100` đúng như Slide 4 yêu cầu để tránh rủi ro mạng/thời gian.
   - Nhớ điền **phuocntme** ở Slide 1 và **https://github.com/phuocntme/AIDA** ở Slide 8 trước khi xuất slide.

2. **Trả lời nhanh Q&A từ Ban Giám Khảo**:
   - **Hỏi: `keccak(nonce)` hoạt động cụ thể thế nào để chống replay và cướp giao dịch?**
     - *Trả lời*: Khi server trả `402`, nó cấp một `nonce` ngẫu nhiên qua HTTP (`X-PAYMENT` flow trong `packages/sdk/src/x402.ts`). Agent thanh toán phải gửi `keccak256(nonce)` vào `calldata` giao dịch AVAX. Server kiểm tra `tx.input == keccak256(nonce)`, `tx.from == caller.owner`, `tx.value >= price`, và khóa `txHash` vào `usedTx` trước khi chờ xác minh để chặn dùng lại hoặc double-spend đồng thời.
   - **Hỏi: Hiện tại chống tự đánh giá thế nào, và làm sao xử lý Sybil sau này?**
     - *Trả lời*: `ReputationRegistry.sol` chặn `msg.sender == identity.ownerOf(agentId)` (`SelfFeedback`). Để giải quyết Sybil triệt để theo Roadmap, tụi mình sẽ yêu cầu chữ ký ủy quyền `feedbackAuth` chuẩn ERC-8004 và tính điểm trung bình có trọng số dựa trên chính uy tín của ví đi đánh giá.
