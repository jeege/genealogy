package photo

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// makeJPEG 生成指定尺寸的 JPEG 测试图。
func makeJPEG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255})
		}
	}
	buffer := &bytes.Buffer{}
	if err := jpeg.Encode(buffer, img, nil); err != nil {
		t.Fatalf("编码测试图片失败：%v", err)
	}
	return buffer.Bytes()
}

func newTestStore(t *testing.T) (*Store, string) {
	t.Helper()
	root := t.TempDir()
	store, err := NewStore(root, 160)
	if err != nil {
		t.Fatalf("初始化存储失败：%v", err)
	}
	return store, root
}

func TestSaveWritesOriginalAndThumbnail(t *testing.T) {
	store, root := newTestStore(t)
	data := makeJPEG(t, 640, 480)

	stored, err := store.Save(7, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("保存失败：%v", err)
	}

	// 原图必须是逐字节一致（保留元数据，不做重编码）。
	original, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(stored.OriginalPath)))
	if err != nil {
		t.Fatalf("读取原图失败：%v", err)
	}
	if !bytes.Equal(original, data) {
		t.Fatalf("原图内容被改写，长度 %d != %d", len(original), len(data))
	}
	if stored.Width != 640 || stored.Height != 480 {
		t.Fatalf("尺寸记录错误：%dx%d", stored.Width, stored.Height)
	}
	if stored.ByteSize != int64(len(data)) {
		t.Fatalf("字节数记录错误：%d", stored.ByteSize)
	}
	// 按成员分目录。
	if !strings.HasPrefix(stored.OriginalPath, "7/") {
		t.Fatalf("应按成员 ID 分目录，实际 %s", stored.OriginalPath)
	}

	// 缩略图存在且最长边不超过上限。
	thumbFile, err := os.Open(filepath.Join(root, filepath.FromSlash(stored.ThumbnailPath)))
	if err != nil {
		t.Fatalf("缩略图不存在：%v", err)
	}
	defer thumbFile.Close()
	cfg, format, err := image.DecodeConfig(thumbFile)
	if err != nil {
		t.Fatalf("缩略图无法解码：%v", err)
	}
	if format != "jpeg" {
		t.Fatalf("缩略图格式应保持 jpeg，实际 %s", format)
	}
	if cfg.Width > 160 || cfg.Height > 160 {
		t.Fatalf("缩略图超过最长边上限：%dx%d", cfg.Width, cfg.Height)
	}
	// 等比缩放：640x480 → 160x120。
	if cfg.Width != 160 || cfg.Height != 120 {
		t.Fatalf("缩略图比例错误：%dx%d，期望 160x120", cfg.Width, cfg.Height)
	}
}

func TestSaveKeepsSmallImageUnscaled(t *testing.T) {
	store, root := newTestStore(t)
	data := makeJPEG(t, 100, 80)

	stored, err := store.Save(1, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("保存失败：%v", err)
	}
	thumbFile, err := os.Open(filepath.Join(root, filepath.FromSlash(stored.ThumbnailPath)))
	if err != nil {
		t.Fatalf("缩略图不存在：%v", err)
	}
	defer thumbFile.Close()
	cfg, _, err := image.DecodeConfig(thumbFile)
	if err != nil {
		t.Fatalf("缩略图无法解码：%v", err)
	}
	if cfg.Width != 100 || cfg.Height != 80 {
		t.Fatalf("小图不应放大：%dx%d", cfg.Width, cfg.Height)
	}
}

func TestSaveRejectsNonImage(t *testing.T) {
	store, root := newTestStore(t)
	data := []byte("这不是图片")
	if _, err := store.Save(1, bytes.NewReader(data), int64(len(data))); err == nil {
		t.Fatal("非图片内容应被拒绝")
	}
	// 失败时不应留下任何文件。
	entries, err := os.ReadDir(root)
	if err != nil {
		t.Fatalf("读取目录失败：%v", err)
	}
	if len(entries) != 0 {
		t.Fatalf("失败后残留了文件：%v", entries)
	}
}

func TestSaveRejectsOversizedLimit(t *testing.T) {
	store, _ := newTestStore(t)
	data := makeJPEG(t, 64, 64)
	// 传入比实际内容更小的上限，应被拒绝。
	if _, err := store.Save(1, bytes.NewReader(data), int64(len(data)-10)); err == nil {
		t.Fatal("超过大小上限应被拒绝")
	}
}

func TestSavePNGUsesPNGThumbnail(t *testing.T) {
	store, root := newTestStore(t)
	img := image.NewRGBA(image.Rect(0, 0, 400, 300))
	for y := 0; y < 300; y++ {
		for x := 0; x < 400; x++ {
			img.Set(x, y, color.RGBA{R: 20, G: 120, B: 200, A: 255})
		}
	}
	buffer := &bytes.Buffer{}
	if err := png.Encode(buffer, img); err != nil {
		t.Fatalf("编码 PNG 失败：%v", err)
	}
	data := buffer.Bytes()

	stored, err := store.Save(2, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("保存失败：%v", err)
	}
	if !strings.HasSuffix(stored.OriginalPath, ".png") {
		t.Fatalf("扩展名应跟随实际格式：%s", stored.OriginalPath)
	}
	if !strings.HasSuffix(stored.ThumbnailPath, ".png") {
		t.Fatalf("缩略图也应保持 png：%s", stored.ThumbnailPath)
	}
	if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(stored.ThumbnailPath))); err != nil {
		t.Fatalf("缩略图不存在：%v", err)
	}
}

func TestDeleteRemovesBothFiles(t *testing.T) {
	store, root := newTestStore(t)
	data := makeJPEG(t, 200, 200)
	stored, err := store.Save(3, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("保存失败：%v", err)
	}
	if err := store.Delete(stored.OriginalPath, stored.ThumbnailPath); err != nil {
		t.Fatalf("删除失败：%v", err)
	}
	for _, rel := range []string{stored.OriginalPath, stored.ThumbnailPath} {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(rel))); !os.IsNotExist(err) {
			t.Fatalf("文件应已删除：%s", rel)
		}
	}
	// 重复删除不报错。
	if err := store.Delete(stored.OriginalPath); err != nil {
		t.Fatalf("重复删除应视为成功：%v", err)
	}
}

func TestDeleteRejectsPathTraversal(t *testing.T) {
	store, root := newTestStore(t)
	// 在根目录外放一个文件，确认不会被删掉。
	outside := filepath.Join(filepath.Dir(root), "outside.txt")
	if err := os.WriteFile(outside, []byte("keep"), 0o600); err != nil {
		t.Fatalf("准备文件失败：%v", err)
	}
	defer os.Remove(outside)

	_ = store.Delete("../outside.txt", "../../outside.txt")
	if _, err := os.Stat(outside); err != nil {
		t.Fatalf("越界路径不应删除根目录外的文件：%v", err)
	}
}

// 真实尺寸照片的完整链路：原图逐字节保留、缩略图按最长边等比缩小。
func TestLargePhotoKeepsOriginalBytesAndScalesThumbnail(t *testing.T) {
	root := t.TempDir()
	// 缩略图最长边 480，验证 3000x2000 → 480x320。
	store, err := NewStore(root, 480)
	if err != nil {
		t.Fatalf("初始化存储失败：%v", err)
	}

	img := image.NewRGBA(image.Rect(0, 0, 3000, 2000))
	for y := 0; y < 2000; y += 3 {
		for x := 0; x < 3000; x += 3 {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 100, A: 255})
		}
	}
	buffer := &bytes.Buffer{}
	if err := jpeg.Encode(buffer, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("编码失败：%v", err)
	}
	data := buffer.Bytes()

	stored, err := store.Save(42, bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("保存失败：%v", err)
	}
	onDisk, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(stored.OriginalPath)))
	if err != nil {
		t.Fatalf("读取原图失败：%v", err)
	}
	if !bytes.Equal(onDisk, data) {
		t.Fatal("原图应逐字节保留")
	}

	thumbFile, err := os.Open(filepath.Join(root, filepath.FromSlash(stored.ThumbnailPath)))
	if err != nil {
		t.Fatalf("缩略图不存在：%v", err)
	}
	defer thumbFile.Close()
	cfg, _, err := image.DecodeConfig(thumbFile)
	if err != nil {
		t.Fatalf("缩略图解码失败：%v", err)
	}
	if cfg.Width != 480 || cfg.Height != 320 {
		t.Fatalf("缩略图应为 480x320，实际 %dx%d", cfg.Width, cfg.Height)
	}
}
