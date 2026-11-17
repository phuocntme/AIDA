# AIDA — pitch slides outline + 2–3 min video script

## Slides (8)
1. **AIDA — Agent IDentity on Avalanche.** Tagline: "Hộ chiếu và điểm uy tín on-chain cho AI agent." Team phuocntme, UniHack 2026.
2. **Vấn đề.** Năm 2026 AI agent tự gọi API, tự trả tiền cho nhau (x402). Nhưng agent không biết bên kia là ai và có đáng tin không: spam bot, agent lừa đảo, agent kém chất lượng đều trông giống nhau.
3. **Giải pháp.** Registry danh tính + uy tín theo chuẩn ERC-8004 trên Avalanche: (1) NFT passport + agent card, (2) khách hàng chấm điểm on-chain, (3) dịch vụ trả phí kiểm tra AIDA trước khi nhận tiền.
4. **Demo flow** (screenshot): SpamBot bị 403 → TranslatorVN nhận 402 → trả 0.01 AVAX → 200 + báo cáo → chấm điểm Oracle.
5. **Kiến trúc.** 2 smart contract (IdentityRegistry ERC-721, ReputationRegistry) · SDK TypeScript · Trust Oracle x402 · Web app. Chạy local Hardhat và Fuji C-Chain.
6. **Vì sao Avalanche.** Phí rẻ + finality < 2s, phù hợp micro-payment giữa agent. EVM nên dùng thẳng ERC-8004. Hướng tới L1 riêng cho traffic agent.
7. **Bảo mật & kiểm thử.** 34 test tự động. Thanh toán gắn với challenge bằng `keccak(nonce)`, chống replay và double-spend, chủ agent không được tự chấm. Giới hạn hiện tại: chưa chống Sybil.
8. **Roadmap.** Validation Registry, feedback có chữ ký, chấm điểm có trọng số, USDC qua facilitator x402 chính thức, L1 riêng. CTA: github.com/phuocntme/AIDA.

## Video script (~2:30)
| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Home hero | "AI agent đang bắt đầu tự trả tiền cho nhau. Nhưng làm sao một agent biết agent kia có đáng tin không? Đó là AIDA." |
| 0:15–0:40 | Directory, trust rings, filter "Rủi ro" | "Mỗi agent có một hộ chiếu NFT trên Avalanche theo chuẩn ERC-8004, kèm điểm uy tín do chính khách hàng chấm on-chain. TranslatorVN 90 điểm, SpamBot chỉ 20." |
| 0:40–1:05 | Register: type, live preview, mint | "Đăng ký agent mới mất 10 giây: điền thông tin, xem trước hộ chiếu, mint on-chain. Agent số 5 đã có danh tính." |
| 1:05–1:30 | Profile #1, act as SpamBot, 403 | "Trust Oracle là một agent bán báo cáo độ tin cậy qua giao thức x402. SpamBot gọi thì bị từ chối ngay, vì uy tín 20, dưới ngưỡng 60. Oracle chưa nhận đồng nào." |
| 1:30–2:05 | Profile #2, act as TranslatorVN, 402 → pay → 200, rate 95 | "TranslatorVN gọi: Oracle trả 402 Payment Required. Agent trả 0.01 AVAX, gửi lại kèm bằng chứng thanh toán, Oracle kiểm tra giao dịch on-chain rồi trả báo cáo. Cuối cùng TranslatorVN chấm Oracle 95 điểm, và uy tín của Oracle tăng ngay." |
| 2:05–2:25 | Terminal `pnpm test` + `pnpm e2e` | "34 test tự động, và cùng flow này chạy được từ một agent không cần giao diện." |
| 2:25–2:35 | Hero | "AIDA: danh tính và uy tín cho nền kinh tế agent, trên Avalanche." |
