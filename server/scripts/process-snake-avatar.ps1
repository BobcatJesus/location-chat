Add-Type -AssemblyName System.Drawing

$sourcePath = (Resolve-Path "public\avatars\source\snake_source.png").Path
$outputDir = (Join-Path (Get-Location) "public\avatars\snake")

if (!(Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$code = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class SnakeSpriteProcessor
{
    const int Target = 128;
    const int Pad = 10;      // transparent margin kept around the tallest pose
    const int Baseline = 6;  // gap between sprite feet and the bottom of the frame

    static bool IsBackground(int argb)
    {
        int r = (argb >> 16) & 0xFF, g = (argb >> 8) & 0xFF, b = argb & 0xFF;
        int min = Math.Min(r, Math.Min(g, b));
        int max = Math.Max(r, Math.Max(g, b));
        return min >= 195 && (max - min) <= 45;
    }

    static bool IsHalo(int argb)
    {
        int r = (argb >> 16) & 0xFF, g = (argb >> 8) & 0xFF, b = argb & 0xFF;
        int min = Math.Min(r, Math.Min(g, b));
        int max = Math.Max(r, Math.Max(g, b));
        return min >= 205 && (max - min) <= 60;
    }

    public static void Run(string sourcePath, string outputDir)
    {
        int w, h;
        int[] px;
        using (var src = new Bitmap(sourcePath))
        {
            w = src.Width;
            h = src.Height;
            using (var argb = new Bitmap(w, h, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(argb)) { g.DrawImage(src, 0, 0, w, h); }
                px = ReadPixels(argb, w, h);
            }
        }
        Console.WriteLine("Source sheet: " + w + "x" + h);

        FloodFillBackground(px, w, h);
        // Two erosion passes strip the near-white anti-aliased fringe left by the fill.
        StripHalo(px, w, h);
        StripHalo(px, w, h);

        var bands = FindBands(px, w, h);
        if (bands.Count < 3) throw new Exception("Expected 3 character bands, found " + bands.Count);
        bands.Sort((a, b) => b.Opaque.CompareTo(a.Opaque));
        bands = bands.GetRange(0, 3);
        bands.Sort((a, b) => a.X0.CompareTo(b.X0));

        foreach (var band in bands) TightenBand(px, w, h, band);

        // One shared scale keeps the three poses in proportion with each other.
        int tallest = 0, widest = 0;
        foreach (var band in bands)
        {
            tallest = Math.Max(tallest, band.Y1 - band.Y0 + 1);
            widest = Math.Max(widest, band.X1 - band.X0 + 1);
        }
        double scale = Math.Min((double)(Target - Pad) / tallest, (double)(Target - Pad) / widest);

        string[] labels = { "front", "back", "side" };
        for (int i = 0; i < 3; i++)
        {
            var band = bands[i];
            string name = labels[i];
            int bw = band.X1 - band.X0 + 1;
            int bh = band.Y1 - band.Y0 + 1;
            Console.WriteLine(name + ": (" + band.X0 + "," + band.Y0 + ") to (" + band.X1 + "," + band.Y1 + ") " + bw + "x" + bh);

            using (var isolated = Crop(px, w, band))
            {
                // Side art must face right; the base sprite flips it when walking left.
                if (name == "side") isolated.RotateFlip(RotateFlipType.RotateNoneFlipX);

                int dw = Math.Max(1, (int)Math.Round(bw * scale));
                int dh = Math.Max(1, (int)Math.Round(bh * scale));
                int dx = (Target - dw) / 2;
                int dy = Target - dh - Baseline;

                Render(isolated, Path.Combine(outputDir, name + "-step1.png"), dx, dy, dw, dh);
                int dw2 = (int)Math.Round(dw * 1.03);
                int dh2 = (int)Math.Round(dh * 0.97);
                Render(isolated, Path.Combine(outputDir, name + "-step2.png"), (Target - dw2) / 2, dy + (dh - dh2), dw2, dh2);
            }
        }
    }

    static int[] ReadPixels(Bitmap bmp, int w, int h)
    {
        var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var px = new int[w * h];
        System.Runtime.InteropServices.Marshal.Copy(data.Scan0, px, 0, px.Length);
        bmp.UnlockBits(data);
        return px;
    }

    static void FloodFillBackground(int[] px, int w, int h)
    {
        var stack = new Stack<int>();
        var seen = new bool[px.Length];
        Action<int, int> seed = (x, y) =>
        {
            int idx = y * w + x;
            if (!seen[idx]) { seen[idx] = true; stack.Push(idx); }
        };
        for (int x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
        for (int y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }

        while (stack.Count > 0)
        {
            int idx = stack.Pop();
            if (!IsBackground(px[idx])) continue;
            px[idx] = 0;
            int x = idx % w, y = idx / w;
            if (x > 0 && !seen[idx - 1]) { seen[idx - 1] = true; stack.Push(idx - 1); }
            if (x < w - 1 && !seen[idx + 1]) { seen[idx + 1] = true; stack.Push(idx + 1); }
            if (y > 0 && !seen[idx - w]) { seen[idx - w] = true; stack.Push(idx - w); }
            if (y < h - 1 && !seen[idx + w]) { seen[idx + w] = true; stack.Push(idx + w); }
        }
    }

    static void StripHalo(int[] px, int w, int h)
    {
        var kill = new List<int>();
        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                int idx = y * w + x;
                if ((px[idx] >> 24) == 0) continue;
                bool edge = (x > 0 && (px[idx - 1] >> 24) == 0)
                    || (x < w - 1 && (px[idx + 1] >> 24) == 0)
                    || (y > 0 && (px[idx - w] >> 24) == 0)
                    || (y < h - 1 && (px[idx + w] >> 24) == 0);
                if (edge && IsHalo(px[idx])) kill.Add(idx);
            }
        }
        foreach (int idx in kill) px[idx] = 0;
    }

    public class Band { public int X0, X1, Y0, Y1; public long Opaque; }

    static List<Band> FindBands(int[] px, int w, int h)
    {
        var counts = new int[w];
        for (int y = 0; y < h; y++)
            for (int x = 0; x < w; x++)
                if ((px[y * w + x] >> 24) != 0) counts[x]++;

        int gapLimit = Math.Max(8, w / 120);
        var bands = new List<Band>();
        int x0 = -1, gap = 0;
        for (int x = 0; x < w; x++)
        {
            if (counts[x] > 0)
            {
                if (x0 < 0) x0 = x;
                gap = 0;
            }
            else if (x0 >= 0)
            {
                gap++;
                if (gap >= gapLimit) { bands.Add(new Band { X0 = x0, X1 = x - gap }); x0 = -1; gap = 0; }
            }
        }
        if (x0 >= 0) bands.Add(new Band { X0 = x0, X1 = w - 1 });

        foreach (var band in bands)
        {
            long total = 0;
            for (int x = band.X0; x <= band.X1; x++) total += counts[x];
            band.Opaque = total;
            band.Y0 = 0;
            band.Y1 = h - 1;
        }
        return bands;
    }

    static void TightenBand(int[] px, int w, int h, Band band)
    {
        int minX = int.MaxValue, maxX = int.MinValue, minY = int.MaxValue, maxY = int.MinValue;
        for (int y = 0; y < h; y++)
        {
            for (int x = band.X0; x <= band.X1; x++)
            {
                if ((px[y * w + x] >> 24) == 0) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        band.X0 = minX; band.X1 = maxX; band.Y0 = minY; band.Y1 = maxY;
    }

    static Bitmap Crop(int[] px, int w, Band band)
    {
        int bw = band.X1 - band.X0 + 1;
        int bh = band.Y1 - band.Y0 + 1;
        var bmp = new Bitmap(bw, bh, PixelFormat.Format32bppArgb);
        var data = bmp.LockBits(new Rectangle(0, 0, bw, bh), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        var buffer = new int[bw * bh];
        for (int y = 0; y < bh; y++)
            for (int x = 0; x < bw; x++)
                buffer[y * bw + x] = px[(band.Y0 + y) * w + (band.X0 + x)];
        System.Runtime.InteropServices.Marshal.Copy(buffer, 0, data.Scan0, buffer.Length);
        bmp.UnlockBits(data);
        return bmp;
    }

    static void Render(Bitmap isolated, string path, int dx, int dy, int dw, int dh)
    {
        using (var frame = new Bitmap(Target, Target, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(frame))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = SmoothingMode.HighQuality;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.DrawImage(isolated, new Rectangle(dx, dy, dw, dh), new Rectangle(0, 0, isolated.Width, isolated.Height), GraphicsUnit.Pixel);
            }
            frame.Save(path, ImageFormat.Png);
        }
    }
}
'@

Add-Type -TypeDefinition $code -ReferencedAssemblies System.Drawing

[SnakeSpriteProcessor]::Run($sourcePath, $outputDir)
Write-Host "Snake avatar frames regenerated (background flood-filled, bands isolated, side facing right)."
