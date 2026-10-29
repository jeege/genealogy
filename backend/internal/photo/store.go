// Package photo 负责成员照片的落盘、缩略图生成与删除。
//
// 存储布局（相对 PhotoStorageDir）：
//
//	<memberID>/<随机名>.<ext>          原图
//	<memberID>/<随机名>.thumb.<ext>    缩略图
//
// 按成员分目录便于人工排查，也方便整体备份/迁移。文件名使用随机 token
// 而非原始文件名，避免路径穿越与重名覆盖；数据库只保存相对路径。
package photo

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"

	"golang.org/x/image/draw"

	// 注册解码器，供 image.Decode 识别用户上传的格式。
	_ "image/gif"

	// WebP 不支持编码，但允许解码后转存为 JPEG/PNG 缩略图。
	_ "golang.org/x/image/webp"
)

// MaxSourcePixels 限制解码后的像素总量，防止「解压炸弹」把内存打满。
// 8000 万像素约等于 1 万×8 千，远超族谱照片的实际需求。
const MaxSourcePixels = 80_000_000

var (
	// ErrUnsupportedFormat 表示文件不是可识别的图片格式。
	ErrUnsupportedFormat = errors.New("不支持的图片格式，请上传 JPEG、PNG、GIF 或 WebP")
	// ErrTooLarge 表示图片像素过多。
	ErrTooLarge = errors.New("图片尺寸过大，请压缩后再上传")
)

// Stored 是一次成功保存的结果，字段与 member_photos 表对应。
type Stored struct {
	OriginalPath  string
	ThumbnailPath string
	Width         int
	Height        int
	ByteSize      int64
}

// Store 把照片写入磁盘。
type Store struct {
	root          string
	thumbnailEdge int
}

// NewStore 创建存储；root 目录不存在时会自动创建。
func NewStore(root string, thumbnailMaxEdge int) (*Store, error) {
	if strings.TrimSpace(root) == "" {
		return nil, errors.New("照片存储目录不能为空")
	}
	if thumbnailMaxEdge <= 0 {
		thumbnailMaxEdge = 480
	}
	if err := os.MkdirAll(root, 0o755); err != nil {
		return nil, fmt.Errorf("创建照片目录失败：%w", err)
	}
	return &Store{root: root, thumbnailEdge: thumbnailMaxEdge}, nil
}

// Root 返回存储根目录（绝对或相对初始化时传入的路径）。
func (s *Store) Root() string { return s.root }

// Save 保存原图并生成缩略图。
//
// 原图按字节原样写入（不做重编码，保留 EXIF 等元数据）；
// 缩略图按最长边不超过 thumbnailMaxEdge 等比缩放，重编码丢弃元数据。
func (s *Store) Save(memberID int64, src io.Reader, size int64) (Stored, error) {
	// 先完整读入内存再解码：需要两次读取（原样落盘 + 解码），
	// 且能在写文件前就完成校验，失败时不留下垃圾文件。
	data, err := io.ReadAll(io.LimitReader(src, size+1))
	if err != nil {
		return Stored{}, fmt.Errorf("读取上传内容失败：%w", err)
	}
	if int64(len(data)) > size {
		return Stored{}, fmt.Errorf("文件超过 %d MB", size>>20)
	}

	cfg, format, err := image.DecodeConfig(strings.NewReader(string(data)))
	if err != nil {
		return Stored{}, ErrUnsupportedFormat
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return Stored{}, ErrUnsupportedFormat
	}
	if int64(cfg.Width)*int64(cfg.Height) > MaxSourcePixels {
		return Stored{}, ErrTooLarge
	}

	// 原图扩展名跟随实际格式，而不是用户文件名，避免 .jpg 里装 PNG。
	ext := extensionFor(format)
	dir := strconv.FormatInt(memberID, 10)
	if err := os.MkdirAll(filepath.Join(s.root, dir), 0o755); err != nil {
		return Stored{}, fmt.Errorf("创建成员照片目录失败：%w", err)
	}

	token, err := randomToken()
	if err != nil {
		return Stored{}, err
	}
	baseName := token + ext
	originalRel := path.Join(dir, baseName)
	thumbRel := path.Join(dir, token+".thumb"+ext)

	if err := os.WriteFile(filepath.Join(s.root, filepath.FromSlash(originalRel)), data, 0o644); err != nil {
		return Stored{}, fmt.Errorf("写入原图失败：%w", err)
	}

	// 解码原图用于生成缩略图；失败时清理已写入的原图。
	img, _, err := image.Decode(strings.NewReader(string(data)))
	if err != nil {
		_ = os.Remove(filepath.Join(s.root, filepath.FromSlash(originalRel)))
		return Stored{}, ErrUnsupportedFormat
	}
	thumb := scaleDown(img, s.thumbnailEdge)
	if err := writeImage(filepath.Join(s.root, filepath.FromSlash(thumbRel)), thumb, format); err != nil {
		_ = os.Remove(filepath.Join(s.root, filepath.FromSlash(originalRel)))
		return Stored{}, fmt.Errorf("写入缩略图失败：%w", err)
	}

	return Stored{
		OriginalPath:  originalRel,
		ThumbnailPath: thumbRel,
		Width:         cfg.Width,
		Height:        cfg.Height,
		ByteSize:      int64(len(data)),
	}, nil
}

// Delete 删除一张照片的原图与缩略图；文件不存在视为成功。
//
// 只接受相对路径，并拒绝任何越出根目录的写法，避免被构造的路径删到别处。
func (s *Store) Delete(relativePaths ...string) error {
	var firstErr error
	for _, rel := range relativePaths {
		if strings.TrimSpace(rel) == "" {
			continue
		}
		full, err := s.resolve(rel)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		if err := os.Remove(full); err != nil && !os.IsNotExist(err) && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

// resolve 把数据库里的相对路径转成安全的绝对路径。
func (s *Store) resolve(rel string) (string, error) {
	cleaned := path.Clean("/" + strings.ReplaceAll(rel, "\\", "/"))
	if cleaned == "/" {
		return "", errors.New("照片路径无效")
	}
	full := filepath.Join(s.root, filepath.FromSlash(cleaned))
	// 二次校验：结果必须仍在根目录内。
	rootAbs, err := filepath.Abs(s.root)
	if err != nil {
		return "", err
	}
	fullAbs, err := filepath.Abs(full)
	if err != nil {
		return "", err
	}
	if !strings.HasPrefix(fullAbs, rootAbs+string(os.PathSeparator)) {
		return "", errors.New("照片路径越界")
	}
	return fullAbs, nil
}

// scaleDown 等比缩放到最长边不超过 maxEdge；本来就小的图直接返回。
func scaleDown(src image.Image, maxEdge int) image.Image {
	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= maxEdge && height <= maxEdge {
		return src
	}
	scale := float64(maxEdge) / float64(max(width, height))
	targetW := max(1, int(float64(width)*scale))
	targetH := max(1, int(float64(height)*scale))

	// 用 CatmullRom 而非最近邻，缩略图观感更接近原图。
	dst := image.NewRGBA(image.Rect(0, 0, targetW, targetH))
	draw.CatmullRom.Scale(dst, dst.Bounds(), src, bounds, draw.Over, nil)
	return dst
}

// writeImage 按原图格式编码缩略图；GIF/WebP 统一转成 JPEG（不支持编码）。
func writeImage(dst string, img image.Image, sourceFormat string) error {
	file, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer file.Close()

	switch sourceFormat {
	case "png":
		encoder := png.Encoder{CompressionLevel: png.BestSpeed}
		return encoder.Encode(file, img)
	default:
		// JPEG 不支持透明通道，先铺白底避免 PNG 透明区域变黑。
		return jpeg.Encode(file, flattenOnWhite(img), &jpeg.Options{Quality: 82})
	}
}

// flattenOnWhite 把带透明度的图片合成到白底上。
func flattenOnWhite(src image.Image) image.Image {
	bounds := src.Bounds()
	dst := image.NewRGBA(bounds)
	// 先填白，再用 Over 合成原图。
	draw.Draw(dst, bounds, image.White, image.Point{}, draw.Src)
	draw.Draw(dst, bounds, src, bounds.Min, draw.Over)
	return dst
}

func extensionFor(format string) string {
	switch format {
	case "png":
		return ".png"
	case "gif":
		return ".gif"
	case "webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func randomToken() (string, error) {
	buffer := make([]byte, 12)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("生成文件名失败：%w", err)
	}
	return hex.EncodeToString(buffer), nil
}
