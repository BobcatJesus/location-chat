Add-Type -AssemblyName System.Drawing

$code = @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

public static class AvatarFrameNormalizer
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

    class Frame
    {
        public string Name;
        public int W, H;
        public int[] Px;
        public int X0, X1, Y0, Y1;
        public bool Empty;
        public double Mult = 1.0;
    }

    // Cleans white backgrounds, crops to content, mirrors side poses to face right,
    // and re-renders every pose at one shared scale on a common baseline.
    public static void Run(string srcDir, string outDir, bool mirrorSide)
    {
        string[] names = { "front-step1", "front-step2", "back-step1", "back-step2", "side-step1", "side-step2" };
        var frames = new List<Frame>();

        foreach (string name in names)
        {
            string path = Path.Combine(srcDir, name + ".png");
            if (!File.Exists(path)) throw new FileNotFoundException("Missing frame", path);

            var frame = new Frame { Name = name };
            using (var src = new Bitmap(path))
            {
                frame.W = src.Width;
                frame.H = src.Height;
                using (var argb = new Bitmap(frame.W, frame.H, PixelFormat.Format32bppArgb))
                {
                    using (var g = Graphics.FromImage(argb)) { g.DrawImage(src, 0, 0, frame.W, frame.H); }
                    frame.Px = ReadPixels(argb, frame.W, frame.H);
                }
            }

            FloodFillBackground(frame.Px, frame.W, frame.H);
            StripHalo(frame.Px, frame.W, frame.H);
            StripHalo(frame.Px, frame.W, frame.H);
            Tighten(frame);
            if (frame.Empty) throw new Exception("Frame is fully transparent after cleanup: " + name);

            Console.WriteLine(name + ": source " + frame.W + "x" + frame.H + " -> content "
                + (frame.X1 - frame.X0 + 1) + "x" + (frame.Y1 - frame.Y0 + 1));
            frames.Add(frame);
        }

        // Some step2 poses are drawn at a different size than their step1; matching them
        // keeps the walk cycle from pulsing.
        foreach (string dirName in new[] { "front", "back", "side" })
        {
            var a = frames.Find(f => f.Name == dirName + "-step1");
            var b = frames.Find(f => f.Name == dirName + "-step2");
            double ha = a.Y1 - a.Y0 + 1;
            double hb = b.Y1 - b.Y0 + 1;
            if (Math.Abs(hb - ha) / ha > 0.10)
            {
                b.Mult = ha / hb;
                Console.WriteLine(dirName + "-step2 rescaled x" + b.Mult.ToString("0.000") + " to match step1");
            }
        }

        double tallest = 0, widest = 0;
        foreach (var f in frames)
        {
            tallest = Math.Max(tallest, (f.Y1 - f.Y0 + 1) * f.Mult);
            widest = Math.Max(widest, (f.X1 - f.X0 + 1) * f.Mult);
        }
        double scale = Math.Min((Target - Pad) / tallest, (Target - Pad) / widest);

        foreach (var f in frames)
        {
            int bw = f.X1 - f.X0 + 1;
            int bh = f.Y1 - f.Y0 + 1;
            double frameScale = scale * f.Mult;
            using (var isolated = Crop(f))
            {
                if (mirrorSide && f.Name.StartsWith("side")) isolated.RotateFlip(RotateFlipType.RotateNoneFlipX);
                int dw = Math.Max(1, (int)Math.Round(bw * frameScale));
                int dh = Math.Max(1, (int)Math.Round(bh * frameScale));
                Render(isolated, Path.Combine(outDir, f.Name + ".png"), (Target - dw) / 2, Target - dh - Baseline, dw, dh, frameScale);
            }
        }
        Console.WriteLine("Normalized " + frames.Count + " frames into " + outDir + " (scale " + scale.ToString("0.000") + ")");
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
            int alpha = (px[idx] >> 24) & 0xFF;
            if (alpha != 0 && !IsBackground(px[idx])) continue;
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
                if (((px[idx] >> 24) & 0xFF) == 0) continue;
                bool edge = (x > 0 && ((px[idx - 1] >> 24) & 0xFF) == 0)
                    || (x < w - 1 && ((px[idx + 1] >> 24) & 0xFF) == 0)
                    || (y > 0 && ((px[idx - w] >> 24) & 0xFF) == 0)
                    || (y < h - 1 && ((px[idx + w] >> 24) & 0xFF) == 0);
                if (edge && IsHalo(px[idx])) kill.Add(idx);
            }
        }
        foreach (int idx in kill) px[idx] = 0;
    }

    static void Tighten(Frame f)
    {
        int minX = int.MaxValue, maxX = int.MinValue, minY = int.MaxValue, maxY = int.MinValue;
        for (int y = 0; y < f.H; y++)
        {
            for (int x = 0; x < f.W; x++)
            {
                if (((f.Px[y * f.W + x] >> 24) & 0xFF) == 0) continue;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
        f.Empty = maxX < minX;
        f.X0 = minX; f.X1 = maxX; f.Y0 = minY; f.Y1 = maxY;
    }

    static Bitmap Crop(Frame f)
    {
        int bw = f.X1 - f.X0 + 1;
        int bh = f.Y1 - f.Y0 + 1;
        var bmp = new Bitmap(bw, bh, PixelFormat.Format32bppArgb);
        var data = bmp.LockBits(new Rectangle(0, 0, bw, bh), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        var buffer = new int[bw * bh];
        for (int y = 0; y < bh; y++)
            for (int x = 0; x < bw; x++)
                buffer[y * bw + x] = f.Px[(f.Y0 + y) * f.W + (f.X0 + x)];
        System.Runtime.InteropServices.Marshal.Copy(buffer, 0, data.Scan0, buffer.Length);
        bmp.UnlockBits(data);
        return bmp;
    }

    static void Render(Bitmap isolated, string path, int dx, int dy, int dw, int dh, double scale)
    {
        using (var frame = new Bitmap(Target, Target, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(frame))
            {
                g.Clear(Color.Transparent);
                // Upscaling small pixel art stays crisp with nearest neighbour.
                g.InterpolationMode = scale > 1.2 ? InterpolationMode.NearestNeighbor : InterpolationMode.HighQualityBicubic;
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

$models = @("bunny", "turtle")
foreach ($model in $models) {
    $dir = (Resolve-Path "public\avatars\$model").Path
    $backup = Join-Path (Get-Location) "public\avatars\source\${model}_raw"
    if (!(Test-Path $backup)) {
        New-Item -ItemType Directory -Path $backup -Force | Out-Null
        Copy-Item (Join-Path $dir "*.png") $backup
        Write-Host "Backed up original $model frames to $backup"
    }
    # Always re-derive from the untouched originals so reruns stay idempotent.
    [AvatarFrameNormalizer]::Run($backup, $dir, $true)
}
