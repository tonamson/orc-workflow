# ORC Studio — thiết kế UI Next.js

## Trạng thái và mục tiêu

Ngày 2026-10-08, người dùng xác nhận “giao diện ổn rồi” sau bản 11. Đây là chốt giao diện và workflow trực quan. Tài liệu này tổng hợp thiết kế đã duyệt để chuẩn bị chuyển mockup thành frontend Next.js; tài liệu cần được người dùng đọc và duyệt trước khi lập kế hoạch triển khai.

ORC Studio là văn phòng AI dành cho CEO quản lý công việc của từng dự án/repo. Các phiên CLI được thể hiện bằng nhân vật pixel trong phòng ban, tổ chức theo Supervisor → Lead → Peer. Người dùng phải biết agent đang làm gì, ai phụ trách, dùng CLI/model/reasoning nào, và khi nào cần can thiệp.

Phạm vi triển khai đầu tiên là frontend với dữ liệu và sự kiện mô phỏng có cấu trúc. Chạy CLI, đăng nhập thật, lưu hồ sơ và triển khai server thuộc giai đoạn backend tiếp theo. Khi chuyển sang Next.js, cần kiểm tra lại hình ảnh và workflow trước khi nối CLI.

## Mốc thiết kế đã duyệt

- Mockup: `.superpowers/brainstorm/57389-1791431517/content/pixel-office-seated-alignment-v11-delivery.html`.
- Artwork văn phòng: `office-art-orthographic-v9.png` trong thư mục content trên.
- Nhân vật: `agent-sprites-v4.png`; lấy đúng vùng từng tư thế trong atlas, không chia atlas thành các ô đều.
- Logo CLI: `logo-codex.svg`, `logo-claude.svg`, `logo-gemini.svg`, `logo-opencode.svg`.
- Ảnh đối chiếu: `/private/tmp/orc-seated-room-v11-final.png`, `/private/tmp/orc-seated-mobile-v11-final.png`, `/private/tmp/orc-seated-overview-v11-final.png`.

Frontend cần mang artwork và tọa độ đã duyệt vào thư mục asset của ứng dụng. Không phụ thuộc vào server visual companion hoặc đường dẫn `/private/tmp` để chạy ứng dụng.

## Giao diện và bố cục

Phong cách giữ nguyên: văn phòng 2D pixel chi tiết, gỗ ấm và xanh sage; phần điều khiển có chữ rõ ràng, khoảng cách thoáng, terminal tối. Tường và ranh giới phòng ngang/dọc, góc vuông, không phối cảnh xiên.

Desktop dùng toàn trang: thanh điều hướng, khu văn phòng chính, panel agent/hồ sơ bên phải. Mobile dùng bố cục riêng: bản đồ vừa chiều ngang màn hình, danh sách agent dễ đọc, điều hướng dưới và bottom sheet cho terminal/hồ sơ. Panel đóng/mở không làm hình phòng bị kéo giãn. Trang không tràn ngang ở kích thước 390×844.

Toàn cảnh mặc định ghép các phòng thành một văn phòng lớn. Giữ tùy chọn “Từng phòng” để xem dạng các ô. Bấm phòng làm việc mở đúng một phòng, có nút quay về toàn cảnh; không phóng to toàn bản đồ. Phòng khách/phòng họp mở nội thất phòng cùng danh sách hồ sơ liên quan.

Phòng ban có thể mở rộng N phòng, tìm theo tên và cuộn để xem. Tối thiểu phải kiểm tra 64 phòng ban cộng các phòng mặc định. Các phòng mở rộng giữ cùng tỷ lệ artwork; hành lang nối liên tục, mặt tiền chỉ xuất hiện ở cuối văn phòng. Chỉ các room/agent nằm trong vùng hiển thị cần animation liên tục; cập nhật trạng thái vẫn được giữ trong store.

## Workspace, phòng ban và phiên

Mỗi workspace tương ứng một project/repo được chọn trên server. Next.js, repo và CLI dự kiến chạy trên server; domain phục vụ người dùng và khách online. Đường dẫn repo của UI đầu tiên là dữ liệu mô phỏng, chưa có bộ chọn filesystem thật.

Workspace có danh sách phòng ban, phòng làm việc, nhiệm vụ, phiên và lịch sử riêng. Chuyển workspace chỉ chuyển ngữ cảnh, không tự mở hay đóng CLI. Những phiên còn chạy ở workspace khác vẫn tính vào giới hạn tài nguyên toàn server.

Phòng ban là nhóm chuyên môn; một phòng ban có thể có nhiều phòng làm việc. Mỗi phòng làm việc chứa tối đa 3 agent/phiên, tính cả Lead. Khi cần agent thứ tư, dùng hoặc tạo phòng khác cùng phòng ban. Không nhân bản Lead hoặc một phiên chỉ để điền phòng mới.

Tạo workspace, phòng ban hoặc phòng dữ liệu chỉ tạo cấu hình. Một nhân vật xuất hiện khi và chỉ khi có một phiên CLI tồn tại; Supervisor cũng tuân theo quy tắc này. Phòng trống hiển thị 0 phiên, không có nhân vật giả. Dữ liệu demo khởi tạo các phiên rõ ràng và được gắn nhãn mô phỏng.

## Phòng mặc định và quyền hiển thị

Ngoài phòng Supervisor, workspace có hai phòng dữ liệu mặc định. Hai phòng này không tự mở phiên CLI.

**Phòng khách:** thông tin dự án, hợp đồng, biên bản họp với khách, tiến độ/mốc bàn giao và tài liệu được chia sẻ. CEO có ghi chú thương mại riêng trong cùng phòng; mục này không hiện cho khách.

**Phòng họp:** biên bản nội bộ, mục tiêu/phạm vi, yêu cầu tính năng, quyết định, vấn đề mở, tài liệu tham khảo và checklist. Supervisor nhận đầu vào từ dữ liệu ở đây để giao việc và theo dõi bàn giao.

| Vai trò | Phòng khách của project được cấp | Phòng họp và nội bộ | Ghi chú thương mại CEO |
| --- | --- | --- | --- |
| CEO | Có | Có | Có |
| Nhân viên | Không | Có | Không |
| Khách | Có, chỉ nội dung được chia sẻ | Không | Không |

Trong frontend đầu tiên, bộ chọn vai trò là công cụ xem thử UI, không phải đăng nhập hoặc phân quyền thật. Mọi danh sách, tìm kiếm, đường vào phòng và panel phải tuân theo vai trò đang xem thử. Khách không được nhìn thấy terminal, bản đồ phòng ban, log hoặc báo cáo nội bộ. Không đưa ghi chú thương mại riêng thành đầu vào chung của agent.

Backend sau này phải kiểm tra quyền theo tài khoản/project/phòng/hồ sơ tại server; việc ẩn UI không thay thế kiểm tra quyền đó.

## Hồ sơ và tiến độ

Danh sách hồ sơ có tên, loại, người được xem, trạng thái và thông tin cập nhật. Bộ lọc theo loại; bấm hồ sơ mở panel chi tiết hoặc bottom sheet trên mobile. Phòng họp có nội dung ghi chú/chỉnh sửa và checklist; lưu trong trạng thái demo và ghi rõ chưa lưu tệp thật.

Luồng bàn giao: Peer báo cáo → Lead xem xét → Supervisor tiếp nhận kết quả → cập nhật checklist nội bộ và tiến độ chia sẻ cho khách. Lead thực hiện công việc cũng báo cáo lên Supervisor.

Chỉ cập nhật phần việc đã xác nhận hoàn thành. Mỗi report/event có ID để không cộng tiến độ hai lần. Animation hết thời gian không phải bằng chứng công việc hoàn thành. Báo cáo/log chi tiết không tự xuất bản vào hồ sơ khách; chỉ dữ liệu chia sẻ được hiển thị ở phòng khách.

## Tương tác với agent và CLI

Bấm nhân vật hoặc mục trong roster mở đúng panel của phiên đó. Panel gồm tên/vai trò, CLI, model ID đầy đủ, cấu hình reasoning, nhiệm vụ, trạng thái, terminal, báo cáo và skill. Gửi prompt hướng đến session ID đã chọn, không đến một terminal chung.

Mỗi nhân vật có logo CLI. Hiện model và reasoning bên cạnh nhân vật trong phòng, trong roster dễ đọc ở toàn cảnh/mobile, và trong terminal. Metadata độc lập với trạng thái nhiệm vụ. Khi CLI thay model hoặc fallback, UI phải hiển thị cấu hình hiệu lực mới.

Giữ ý nghĩa theo provider: effort, thinking level/budget hoặc variant. Không suy ra model từ logo; chưa có metadata thì ghi “Chưa đồng bộ”, provider không hỗ trợ thì ghi “Không hỗ trợ”. Model trong demo chỉ là dữ liệu minh họa, không cam kết phiên bản model hoặc khả năng CLI thật.

UI skill có gợi ý theo provider và giữ cú pháp native của CLI đang chọn. Trong giai đoạn demo, chọn skill/gửi prompt tạo sự kiện và phản hồi mô phỏng, không chạy lệnh. Adapter backend sau này phải hỗ trợ cú pháp và tính năng thực tế của provider thay vì giả lập một tính năng CLI không có.

## Trạng thái, vòng đời và animation

Tách trạng thái phiên khỏi trạng thái nhiệm vụ. Phiên có thể đang khởi động, đang tồn tại, đang đóng, đã đóng, lỗi hoặc mất kết nối. Nhiệm vụ có thể đang nhận việc, làm việc, chờ xác nhận, bị chặn, báo cáo hoặc đã hoàn tất. Không coi agent mất kết nối là đã đóng tiến trình.

Luồng hình ảnh bình thường:

1. Có phiên hợp lệ và nhận nhiệm vụ: nhân vật đi từ cửa qua lối đi đến bàn được cấp.
2. Làm việc: đổi sang tư thế ngồi đúng ghế; CLI/model/reasoning và trạng thái vẫn đọc được.
3. Bàn giao: nhân vật đứng lên, mang báo cáo đến vị trí gần Lead; không chồng lên nhân vật Lead.
4. Hết nhiệm vụ: hoàn thành bàn giao, yêu cầu đóng phiên, đi ra khỏi phòng; trạng thái đóng phải rõ ràng.
5. Xác nhận tiến trình đã dừng: xóa khỏi bản đồ/roster phiên đang chạy, giữ báo cáo trong lịch sử. Đọc báo cáo cũ không mở lại CLI.

Frontend demo dùng bộ phát sự kiện mô phỏng cho các bước trên. Khi nối backend, hoạt ảnh chỉ biểu diễn sự kiện; không tự kết luận tiến trình đã dừng chỉ vì nhân vật đã đi ra khỏi cửa. Đóng thất bại phải báo lỗi và tiếp tục tính phiên vào giới hạn cho đến khi runner xác nhận kết thúc.

Chờ xác nhận có nhãn/icon và thao tác chấp thuận/từ chối. Mất kết nối có trạng thái khác đang làm, có thông tin cập nhật cuối và thao tác khôi phục. Ngồi yên không phải căn cứ để kết luận agent đã chết; trạng thái đến từ sự kiện phiên/runner.

Animation dùng cùng tọa độ artwork cho mọi chế độ xem. Điểm ngồi nằm trên mặt ghế, khác điểm đặt chân khi đứng. Bước chân đổi frame, không để animation transform cũ ghi đè hướng sprite và làm scaleX đi qua 0. Hủy timer/animation khi unmount, chuyển phòng hoặc thay luồng demo; không tạo vòng lặp chạy nền cho phiên đã đóng. Với reduced motion, giữ trạng thái và kết quả rõ ràng bằng tư thế/nhãn ổn định.

## Kiểm soát tài nguyên

Giới hạn 3 phiên/phòng là quy tắc bố cục, độc lập với giới hạn số phiên và tài nguyên toàn server. UI hiển thị số phiên còn tồn tại và số slot khả dụng; số 5/6 của demo là ví dụ, không ấn định giới hạn vận hành thật.

Supervisor ưu tiên giao vào phiên phù hợp đang tồn tại; chỉ mở phiên mới khi không có phiên phù hợp và còn ngân sách tài nguyên. Khi hết ngân sách, nhiệm vụ chờ với lý do rõ ràng. Không tạo phòng/phiên hàng loạt chỉ vì tăng số phòng được hiển thị.

Giai đoạn backend chịu trách nhiệm giới hạn đồng thời, timeout khởi động, theo dõi heartbeat, hủy nhiệm vụ và thu hồi tiến trình hết việc. UI không tự đóng phiên đang chờ người điều phối xác nhận hoặc đang có việc chỉ để làm bản đồ trống. RAM/CPU thật chỉ được hiển thị khi có nguồn đo; demo không giả vờ đang đo máy.

## Cấu trúc frontend đề xuất

Next.js App Router và TypeScript. Layout giữ phần tĩnh; khu điều khiển, trạng thái, terminal demo và animation là Client Components. Browser API chỉ truy cập sau khi component chạy trên client, không làm build/server rendering lỗi.

Các đơn vị chức năng chính:

- App shell và điều hướng workspace: ngữ cảnh project, chế độ xem, vai trò demo, panel/mobile sheet.
- Office/room renderer: ghép artwork, hit area, ghế, vị trí agent, kiểm tra hiển thị theo vai trò.
- Agent sprite và motion: atlas frames, tư thế, đường đi, vòng đời animation.
- Session/task store: trạng thái phiên/nhiệm vụ, chọn phiên, giới hạn phòng và bàn giao không trùng.
- Session panel: terminal demo, cấu hình model/reasoning, report và skill composer.
- Project records: phòng dữ liệu, danh sách/bộ lọc, chi tiết, ghi chú và checklist.
- Demo adapter: seed dữ liệu và phát sự kiện phục vụ workflow; là chỗ thay thế bằng adapter thật sau này.

Không mang các lớp override JS/CSS nối tiếp của mockup sang ứng dụng. Chia theo các đơn vị trên để mỗi renderer và trạng thái có một nguồn rõ ràng; giữ kết quả hình ảnh đã duyệt. Dùng CSS hiện có đã tinh gọn và browser animation, không thêm thư viện đồ họa nặng chỉ để hiển thị bản đồ này.

Nguồn tài liệu Next.js đã kiểm tra qua Context7: [Server and Client Components](https://github.com/vercel/next.js/blob/canary/docs/01-app/01-getting-started/05-server-and-client-components.mdx). Phiên bản package cụ thể sẽ được kiểm tra và khóa trong bước lập kế hoạch/cài đặt, không chọn bản canary chỉ vì tài liệu nằm trên nhánh canary.

## Dữ liệu và ranh giới sự kiện

Store dùng ID ổn định cho workspace, department, room, session, task và report. Session liên kết với workspace/room/provider và metadata hiệu lực; room chỉ chứa tham chiếu session, không sao chép session object. Tài liệu có loại, audience, nội dung và project ID.

Các sự kiện cần thể hiện trong demo gồm tạo/cập nhật phiên, đổi cấu hình, giao việc, chờ xác nhận, báo cáo, tiếp nhận bàn giao, mất kết nối và xác nhận phiên đóng. Các handler nhận ID rõ ràng và cập nhật store một lần; rendering/animation không sửa số công việc hoàn thành.

Trước khi làm backend, lập spec riêng cho runner, adapter CLI và protocol đồng bộ; auth/hồ sơ cũng có thiết kế backend riêng. Spec frontend hiện tại xác định ý nghĩa dữ liệu và hành vi UI, không ấn định API endpoint/database chưa được bàn.

## Tiêu chí nghiệm thu frontend

1. Next.js chạy độc lập, build/typecheck thành công; giao diện giữ đúng bản 11 trên desktop và mobile.
2. Các phòng thẳng, không méo; ghép 64 phòng ban đúng hành lang/tỷ lệ, không nhân bản mặt tiền.
3. Click phòng chỉ hiện phòng đó; back về toàn cảnh; chế độ từng phòng vẫn hoạt động.
4. Mỗi phòng tối đa 3 phiên gồm Lead. Phiên thứ tư vào phòng khác cùng phòng ban, không tăng số phiên chỉ vì tạo phòng.
5. Không hiện nhân vật thiếu session; đóng xong gỡ đúng nhân vật/roster và giữ lịch sử.
6. Tất cả ghế được căn đúng ở UI, Engineering và phòng đảo hướng; avatar không nhảy vị trí khi đổi chế độ nhìn.
7. Nhận việc, làm việc, báo cáo, chờ xác nhận và mất kết nối có nhãn rõ ràng; bước chân không chớp/mất sprite.
8. Click agent chọn đúng terminal/CLI; logo, model và reasoning đồng bộ ở panel/roster/map, xử lý được metadata chưa có.
9. Hồ sơ phòng khách/phòng họp mở đúng danh sách/chi tiết, mobile sheet sử dụng được; ma trận vai trò được áp dụng ở mọi đường vào UI.
10. Bàn giao cùng report ID hai lần không tăng tiến độ hai lần; animation tự hoàn thành không tự tăng tiến độ.
11. Chuyển phòng/workspace không tạo phiên mới, không để timer cũ đổi ngữ cảnh bất ngờ; session không có việc được thể hiện theo vòng đời đóng rõ ràng.
12. UI ghi rõ dữ liệu demo, không thực thi CLI, không giả login/RBAC hoặc đo tài nguyên thật.

Kiểm tra tự động tập trung vào quy tắc store/session/room, quyền hiển thị, sự kiện bàn giao và cleanup. Kiểm tra trình duyệt so sánh hình ảnh desktop/mobile, tọa độ ghế, không tràn ngang và lấy mẫu transform/frame trong các luồng di chuyển để bắt lỗi chớp tắt đã gặp.

## Thứ tự tiếp theo

1. Người dùng duyệt tài liệu thiết kế này.
2. Viết kế hoạch triển khai frontend Next.js và để người dùng chọn cách thực hiện theo workflow brainstorming.
3. Triển khai, kiểm tra và duyệt luồng trên Next.js.
4. Thiết kế/triển khai runner CLI trên server và dữ liệu realtime; tiếp theo là tài khoản, quyền backend, hồ sơ lưu thật và deployment domain.

Giao diện bản 11 đã chốt. Các bước sau giữ phạm vi thiết kế này; thay đổi lớn hoặc mở rộng backend cần thiết kế riêng, không tự thêm vào lần chuyển frontend.
