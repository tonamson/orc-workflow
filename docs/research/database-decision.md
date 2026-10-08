# PostgreSQL + Docker + TypeORM cho ORC

Ngày2026-10-08. Người dùng chọn PostgreSQL theo đánh giá, yêu cầu triển khai database bằng Docker, mọi thông tin lưu trữ nằm trong database và sử dụng TypeORM để nâng cấp schema về sau. Không dùng Prisma.

## Phạm vi được thực hiện

Lưu bền dữ liệu nghiệp vụ hiện có của Next.js: workspace/customer và grants, phòng ban/phòng, phiên và metadata, tasks/reports, hồ sơ/ghi chú, lịch sử sự kiện và phiên đã đóng. Vai trò xem thử, tìm kiếm và panel đang chọn là ngữ cảnh UI cục bộ, không phải tài khoản đăng nhập thật. Đọc/ghi thông qua server route; không cho browser thay toàn bộ database bằng một snapshot tùy ý.

API hiện phục vụ bản UI demo cục bộ: ngữ cảnh vai trò được chọn trong browser, dữ liệu aggregate chứa các workspace demo. Đây chưa phải bảo mật cho khách online. Trước khi đưa lên domain công khai, backend phải lấy identity/grants từ phiên đăng nhập thật và chỉ trả payload thuộc workspace/phòng được cấp; ẩn giao diện không thay thế kiểm soát quyền ở API.

Docker chạy một PostgreSQL riêng của ORC trên named volume, healthcheck và restart policy. Không dùng database/container của dự án khác. TypeORM DataSource giữ `synchronize:false`; nâng cấp schema bằng migration có lịch sử, chạy lại không nhân bản dữ liệu. Secrets nằm trong env không commit. Phiên bản thư viện được khóa sau khi đối chiếu registry và tài liệu.

Lớp persistence đầu tiên có thể lưu aggregate nghiệp vụ dưới JSONB với revision cùng event history trong một transaction để tái sử dụng reducer hiện có. Đây là lựa chọn triển khai nhỏ, không cam kết giải quyết scale bằng một document duy nhất; các migration tiếp theo có thể tách entities/index theo nhu cầu truy vấn. Thay đổi đồng thời cần revision/lock, event ID chống lặp và xử lý conflict rõ ràng. Chỉ báo lưu thành công sau khi transaction đã commit; cấu hình DB hỏng phải báo lỗi thay vì âm thầm dùng memory và làm người dùng tưởng đã lưu.

## Lưu phiên CLI và tệp

ORC session identity và native CLI conversation identity là dữ liệu riêng. Schema giữ workspace/provider và native conversation reference, cho phép chưa có reference khi demo chưa nối CLI. Không tự tạo native ID giả. Khi tích hợp runtime, lịch sử native, config và supporting artifacts phải được lưu/khôi phục đủ để CLI resume đúng chat cũ. Tệp runtime trên filesystem có thể cần được materialize từ dữ liệu lưu trữ; database chỉ có một ID không đủ khôi phục hội thoại.

Theo yêu cầu mọi thông tin nằm trong DB, metadata và nội dung các tệp được ORC lưu có thể dùng PostgreSQL `bytea` với workspace/session scope. Giai đoạn hiện tại chưa có CLI runtime hoặc màn hình upload tệp thật; không tuyên bố tính năng crash-resume đã hoạt động chỉ vì đã có schema.

## Kiểm chứng

- Docker healthy, migration tạo schema trên DB riêng và lần chạy tiếp không làm mất dữ liệu.
- Ghi ghi chú/metadata/task/report và đọc lại; reload app không reset về seed.
- Restart container DB giữ nguyên dữ liệu, archive và conversation references.
- Hai cập nhật đồng thời không ghi đè mất dữ liệu; replay cùng event/report không tăng tiến độ hai lần.
- Transaction lỗi không ghi một nửa snapshot/history; payload sai bị từ chối.
- Cả workspace ownership và grant vẫn áp dụng trong luồng UI demo.
- Mọi UI/CLI/authentication mô phỏng vẫn được ghi đúng nghĩa; auth thật và runtime là công việc tiếp theo.

## Căn cứ lựa chọn

SQLite phù hợp ứng dụng một máy có workload vừa; WAL cho đọc/ghi đồng thời nhưng chỉ một writer tại một thời điểm, không dùng WAL trên network filesystem. Mô hình server online với nhiều runner/workspace của ORC là lý do kiến trúc để chọn PostgreSQL từ đầu, chưa phải benchmark. [SQLite use cases](https://www.sqlite.org/whentouse.html), [SQLite WAL](https://www.sqlite.org/wal.html).

Độ bền phụ thuộc WAL/fsync/synchronous commit và storage thực tế; database không phục hồi RAM/process hoặc dữ liệu ứng dụng chưa được ghi. [PostgreSQL WAL settings](https://www.postgresql.org/docs/current/runtime-config-wal.html).

TypeORM hỗ trợ DataSource và migration khi tắt synchronize; EntitySchema phù hợp TypeScript hiện có mà không yêu cầu thêm decorators. [TypeORM migrations](https://typeorm.io/docs/migrations/setup/), [EntitySchema](https://typeorm.io/docs/entity/separating-entity-definition/).

Container PostgreSQL18 dùng data layout/versioned PGDATA của image chính thức. Named volume phải được mount đúng vị trí và không xóa khi cập nhật ứng dụng. [Official PostgreSQL image](https://github.com/docker-library/docs/blob/master/postgres/README.md).
