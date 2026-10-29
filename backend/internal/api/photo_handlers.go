package api

import (
	"context"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/yunfengsa/pure-genealogy/backend/internal/domain"
	"github.com/yunfengsa/pure-genealogy/backend/internal/photo"
)

// 单次请求最多上传的照片数，避免一次拖入整个相册把内存打满。
const maxPhotosPerRequest = 20

// photoURL 把数据库里的相对路径拼成前端可访问的 URL。
//
// 用 url.PathEscape 逐段转义，避免目录名或文件名中的特殊字符破坏 URL。
func (s *Server) photoURL(relativePath string) string {
	if relativePath == "" {
		return ""
	}
	segments := strings.Split(strings.TrimPrefix(relativePath, "/"), "/")
	for index, segment := range segments {
		segments[index] = url.PathEscape(segment)
	}
	// 兜底默认值：config 正常加载时一定非空，这里避免手工构造的 Config
	//（测试、嵌入式调用）拼出 "/5/abc.jpg" 这种以斜杠开头的相对 URL。
	prefix := strings.TrimSuffix(s.cfg.PhotoURLPrefix, "/")
	if prefix == "" {
		prefix = "/api/photos"
	}
	return prefix + "/" + strings.Join(segments, "/")
}

// withPhotoURLs 填好 URL 字段，屏蔽磁盘路径细节。
func (s *Server) withPhotoURLs(photos []domain.MemberPhoto) []domain.MemberPhoto {
	for index := range photos {
		photos[index].URL = s.photoURL(photos[index].URL)
		photos[index].ThumbURL = s.photoURL(photos[index].ThumbURL)
	}
	return photos
}

func (s *Server) handleListMemberPhotos(w http.ResponseWriter, r *http.Request) {
	memberID, err := parseMemberID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	photos, err := s.members.ListMemberPhotos(r.Context(), memberID)
	if err != nil {
		s.handleError(w, err, "读取照片")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": s.withPhotoURLs(photos)})
}

func (s *Server) handleUploadMemberPhotos(w http.ResponseWriter, r *http.Request) {
	memberID, err := parseMemberID(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// 确认成员存在，避免给不存在的 ID 写文件。
	if _, err := s.members.GetMember(r.Context(), memberID); err != nil {
		s.handleError(w, err, "读取成员")
		return
	}

	// 允许的请求体比单张上限略大：包含 multipart 边界与其他字段的额外开销。
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.PhotoMaxBytes*maxPhotosPerRequest+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			writeError(w, http.StatusRequestEntityTooLarge, "上传内容过大")
			return
		}
		writeError(w, http.StatusBadRequest, "上传内容格式错误")
		return
	}
	defer func() { _ = r.MultipartForm.RemoveAll() }()

	files, ok := r.MultipartForm.File["photos"]
	if !ok || len(files) == 0 {
		// 兼容一次只传一个文件、字段名叫 photo 的写法。
		files = r.MultipartForm.File["photo"]
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "请选择要上传的照片")
		return
	}
	if len(files) > maxPhotosPerRequest {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("单次最多上传 %d 张照片", maxPhotosPerRequest))
		return
	}

	caption := trimmed(ptr(r.FormValue("caption")))
	saved := make([]domain.MemberPhoto, 0, len(files))
	for _, header := range files {
		stored, err := s.savePhoto(memberID, header)
		if err != nil {
			// 已经存下的照片保留（用户可单独删除），只报告失败的那张。
			s.cleanupSavedPhotos(r.Context(), saved)
			if errors.Is(err, photo.ErrUnsupportedFormat) || errors.Is(err, photo.ErrTooLarge) {
				writeError(w, http.StatusBadRequest, err.Error())
				return
			}
			s.logger.Error("保存照片失败", "error", err, "member", memberID)
			writeError(w, http.StatusInternalServerError, "保存照片失败")
			return
		}
		record, err := s.members.AddMemberPhoto(r.Context(), domain.MemberPhotoInput{
			MemberID:      memberID,
			OriginalPath:  stored.OriginalPath,
			ThumbnailPath: stored.ThumbnailPath,
			Width:         stored.Width,
			Height:        stored.Height,
			ByteSize:      stored.ByteSize,
			Caption:       caption,
		})
		if err != nil {
			// 入库失败要把刚写的文件删掉，避免留下孤儿文件。
			_ = s.photos.Delete(stored.OriginalPath, stored.ThumbnailPath)
			s.cleanupSavedPhotos(r.Context(), saved)
			s.handleError(w, err, "保存照片信息")
			return
		}
		saved = append(saved, record)
	}

	writeJSON(w, http.StatusCreated, map[string]any{"data": s.withPhotoURLs(saved)})
}

// savePhoto 把单个 multipart 文件交给照片存储。
func (s *Server) savePhoto(memberID int64, header *multipart.FileHeader) (photo.Stored, error) {
	if header.Size > s.cfg.PhotoMaxBytes {
		return photo.Stored{}, fmt.Errorf("单张照片不能超过 %d MB", s.cfg.PhotoMaxBytes>>20)
	}
	file, err := header.Open()
	if err != nil {
		return photo.Stored{}, err
	}
	defer file.Close()
	return s.photos.Save(memberID, file, s.cfg.PhotoMaxBytes)
}

// cleanupSavedPhotos 在上传中途失败时回滚已经入库的记录与文件。
//
// 注意 record.URL/ThumbURL 此时还是数据库里的相对路径（尚未经过
// withPhotoURLs 转换），可以直接交给存储层删除。
func (s *Server) cleanupSavedPhotos(ctx context.Context, saved []domain.MemberPhoto) {
	for _, record := range saved {
		original, thumbnail, err := s.members.DeleteMemberPhoto(ctx, record.ID)
		if err != nil {
			continue
		}
		_ = s.photos.Delete(original, thumbnail)
	}
}

func (s *Server) handleDeleteMemberPhoto(w http.ResponseWriter, r *http.Request) {
	photoID, err := parseRouteIDNamed(r, "photoID")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	originalPath, thumbnailPath, err := s.members.DeleteMemberPhoto(r.Context(), photoID)
	if err != nil {
		s.handleError(w, err, "删除照片")
		return
	}
	// 文件删除失败只记日志：数据库记录已经没了，残留文件不影响使用。
	if err := s.photos.Delete(originalPath, thumbnailPath); err != nil {
		s.logger.Warn("删除照片文件失败", "error", err, "photo", photoID)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleUpdatePhotoCaption(w http.ResponseWriter, r *http.Request) {
	photoID, err := parseRouteIDNamed(r, "photoID")
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var payload struct {
		Caption *string `json:"caption"`
	}
	if err := decodeJSON(w, r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if payload.Caption != nil && len([]rune(*payload.Caption)) > 200 {
		writeError(w, http.StatusBadRequest, "照片说明不能超过 200 个字符")
		return
	}
	updated, err := s.members.UpdatePhotoCaption(r.Context(), photoID, trimmed(payload.Caption))
	if err != nil {
		s.handleError(w, err, "更新照片说明")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"data": s.withPhotoURLs([]domain.MemberPhoto{updated})[0]})
}

// handlePhotoFile 提供原图/缩略图的静态读取。
//
// 路径形如 /api/photos/<memberID>/<file>，由 http.FileServer 处理，
// 根目录是 PhotoStorageDir；相对路径已经在存储层做过越界校验。
func (s *Server) handlePhotoFile(w http.ResponseWriter, r *http.Request) {
	if s.photoFiles == nil {
		writeError(w, http.StatusNotFound, "照片服务未启用")
		return
	}
	// 照片本身不敏感（族谱内部数据），但仍要求登录，避免目录被匿名遍历。
	// 浏览器图片请求会自动带上同站 Cookie，因此这里用常规鉴权即可。
	s.photoFiles.ServeHTTP(w, r)
}

func parseRouteIDNamed(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(r.PathValue(name), 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("ID 无效")
	}
	return id, nil
}

func ptr(value string) *string { return &value }
