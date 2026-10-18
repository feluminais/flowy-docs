#:package System.Drawing.Common@10.0.13
#:property NoWarn=CA1416
// Draws the app's icon: three boxes joined by a line, white on the canvas's blue. Run from the repo root (Windows):
//   dotnet run desktop/tools/make-icon.cs
// It writes desktop/Flowy.App/Assets/icon.png (512 px, for Linux and the window), icon.ico (Windows) and icon.icns (macOS).
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

var assets = Path.Combine("desktop", "Flowy.App", "Assets");
Directory.CreateDirectory(assets);

Bitmap Draw(int size)
{
    var bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);
    using var g = Graphics.FromImage(bitmap);
    g.SmoothingMode = SmoothingMode.AntiAlias;
    g.Clear(Color.Transparent);
    g.ScaleTransform(size / 1024f, size / 1024f);

    static GraphicsPath Rounded(float x, float y, float w, float h, float r)
    {
        var path = new GraphicsPath();
        path.AddArc(x, y, 2 * r, 2 * r, 180, 90);
        path.AddArc(x + w - 2 * r, y, 2 * r, 2 * r, 270, 90);
        path.AddArc(x + w - 2 * r, y + h - 2 * r, 2 * r, 2 * r, 0, 90);
        path.AddArc(x, y + h - 2 * r, 2 * r, 2 * r, 90, 90);
        path.CloseFigure();
        return path;
    }

    using (var tile = Rounded(0, 0, 1024, 1024, 224)) g.FillPath(new SolidBrush(ColorTranslator.FromHtml("#2563eb")), tile);
    using var line = new Pen(Color.White, 28) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
    g.DrawLines(line, [new PointF(476, 300), new PointF(512, 300), new PointF(512, 512), new PointF(548, 512)]);
    g.DrawLines(line, [new PointF(476, 724), new PointF(512, 724), new PointF(512, 512)]);
    foreach (var (x, y) in new[] { (176f, 200f), (548f, 412f), (176f, 624f) })
        using (var box = Rounded(x, y, 300, 200, 36)) g.FillPath(Brushes.White, box);
    return bitmap;
}

byte[] Png(int size)
{
    using var bitmap = Draw(size);
    using var stream = new MemoryStream();
    bitmap.Save(stream, ImageFormat.Png);
    return stream.ToArray();
}

// Windows: an .ico whose images are PNGs (Windows Vista and later read them).
int[] sizes = [16, 24, 32, 48, 64, 128, 256];
var pngs = sizes.Select(Png).ToArray();
using (var ico = new BinaryWriter(File.Create(Path.Combine(assets, "icon.ico"))))
{
    ico.Write((short)0); ico.Write((short)1); ico.Write((short)sizes.Length);
    var offset = 6 + 16 * sizes.Length;
    for (var i = 0; i < sizes.Length; i++)
    {
        ico.Write((byte)(sizes[i] == 256 ? 0 : sizes[i])); ico.Write((byte)(sizes[i] == 256 ? 0 : sizes[i]));
        ico.Write((byte)0); ico.Write((byte)0); ico.Write((short)1); ico.Write((short)32);
        ico.Write(pngs[i].Length); ico.Write(offset);
        offset += pngs[i].Length;
    }
    foreach (var png in pngs) ico.Write(png);
}

// Linux and the window: one 512 px PNG.
File.WriteAllBytes(Path.Combine(assets, "icon.png"), Png(512));

// macOS: an .icns whose images are PNGs (types ic08 = 256, ic09 = 512, ic10 = 1024).
var parts = new[] { ("ic08", 256), ("ic09", 512), ("ic10", 1024) }.Select(p => (p.Item1, Png(p.Item2))).ToArray();
using (var icns = new BinaryWriter(File.Create(Path.Combine(assets, "icon.icns"))))
{
    static void Be(BinaryWriter w, int n) { w.Write((byte)(n >> 24)); w.Write((byte)(n >> 16)); w.Write((byte)(n >> 8)); w.Write((byte)n); }
    icns.Write("icns"u8.ToArray());
    Be(icns, 8 + parts.Sum(p => 8 + p.Item2.Length));
    foreach (var (type, png) in parts)
    {
        icns.Write(System.Text.Encoding.ASCII.GetBytes(type));
        Be(icns, 8 + png.Length);
        icns.Write(png);
    }
}
Console.WriteLine($"wrote {assets}\\icon.png, icon.ico, icon.icns");
