Add-Type -AssemblyName System.Drawing

$sourcePath = "public\avatars\source\snake_source.png"
$outputDir = "public\avatars\snake"

if (!(Test-Path $outputDir)) {
    New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
}

$srcBmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path $sourcePath).Path)
$w = $srcBmp.Width
$h = $srcBmp.Height

Write-Host "Processing snake sprite sheet: ${w}x${h}"

# Create 32-bit ARGB image
$argb = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($argb)
$g.DrawImage($srcBmp, 0, 0, $w, $h)
$g.Dispose()
$srcBmp.Dispose()

# Flood fill from boundaries to remove white background without touching white eye glints
$visited = New-Object 'bool[,]' $w, $h
$queue = New-Object System.Collections.Generic.Queue[System.Drawing.Point]

# Enqueue border pixels that are near-white
function IsBackgroundPixel($c) {
    # Near white (R > 246 and G > 246 and B > 246)
    return ($c.R -ge 246 -and $c.G -ge 246 -and $c.B -ge 246)
}

for ($x = 0; $x -lt $w; $x++) {
    if (IsBackgroundPixel ($argb.GetPixel($x, 0))) {
        $visited[$x, 0] = $true
        $queue.Enqueue((New-Object System.Drawing.Point($x, 0)))
    }
    if (IsBackgroundPixel ($argb.GetPixel($x, $h - 1))) {
        $visited[$x, $h - 1] = $true
        $queue.Enqueue((New-Object System.Drawing.Point($x, $h - 1)))
    }
}
for ($y = 0; $y -lt $h; $y++) {
    if (IsBackgroundPixel ($argb.GetPixel(0, $y))) {
        $visited[0, $y] = $true
        $queue.Enqueue((New-Object System.Drawing.Point(0, $y)))
    }
    if (IsBackgroundPixel ($argb.GetPixel($w - 1, $y))) {
        $visited[$w - 1, $y] = $true
        $queue.Enqueue((New-Object System.Drawing.Point($w - 1, $y)))
    }
}

Write-Host "Starting background flood fill..."
while ($queue.Count -gt 0) {
    $pt = $queue.Dequeue()
    $px = $pt.X
    $py = $pt.Y
    
    # Set this background pixel to transparent
    $argb.SetPixel($px, $py, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))

    $neighbors = @(
        (New-Object System.Drawing.Point($px + 1, $py)),
        (New-Object System.Drawing.Point($px - 1, $py)),
        (New-Object System.Drawing.Point($px, $py + 1)),
        (New-Object System.Drawing.Point($px, $py - 1))
    )

    foreach ($n in $neighbors) {
        if ($n.X -ge 0 -and $n.X -lt $w -and $n.Y -ge 0 -and $n.Y -lt $h) {
            if (-not $visited[$n.X, $n.Y]) {
                $visited[$n.X, $n.Y] = $true
                $col = $argb.GetPixel($n.X, $n.Y)
                if (IsBackgroundPixel $col) {
                    $queue.Enqueue($n)
                }
            }
        }
    }
}
Write-Host "Flood fill finished."

# Soft edge pass: for any non-transparent pixel adjacent to transparent, if near-white, make transparent or soft
for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
        $col = $argb.GetPixel($x, $y)
        if ($col.A -gt 0) {
            if ($col.R -gt 240 -and $col.G -gt 240 -and $col.B -gt 240) {
                # Check if neighboring pixel is transparent
                $hasTransNeighbor = $false
                if ($x -gt 0 -and $argb.GetPixel($x - 1, $y).A -eq 0) { $hasTransNeighbor = $true }
                if ($x -lt ($w - 1) -and $argb.GetPixel($x + 1, $y).A -eq 0) { $hasTransNeighbor = $true }
                if ($y -gt 0 -and $argb.GetPixel($x, $y - 1).A -eq 0) { $hasTransNeighbor = $true }
                if ($y -lt ($h - 1) -and $argb.GetPixel($x, $y + 1).A -eq 0) { $hasTransNeighbor = $true }
                if ($hasTransNeighbor) {
                    $argb.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
                }
            }
        }
    }
}

# Process 3 characters
function Process-Figure($name, $x1, $x2) {
    $minX = $x2
    $maxX = $x1
    $minY = $h
    $maxY = 0

    for ($y = 0; $y -lt $h; $y++) {
        for ($x = $x1; $x -lt $x2; $x++) {
            $p = $argb.GetPixel($x, $y)
            if ($p.A -gt 0) {
                if ($x -lt $minX) { $minX = $x }
                if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }
                if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }

    if ($minX -ge $maxX -or $minY -ge $maxY) {
        Write-Host "Error: No pixels found for $name!"
        return
    }

    $bw = $maxX - $minX + 1
    $bh = $maxY - $minY + 1
    Write-Host "$name bounds: ($minX, $minY) to ($maxX, $maxY) -> size ${bw}x${bh}"

    $targetSize = 128
    $scale = [Math]::Min(($targetSize - 20) / $bw, ($targetSize - 20) / $bh)
    $dw = [int]($bw * $scale)
    $dh = [int]($bh * $scale)
    $dx = [int](($targetSize - $dw) / 2)
    $dy = [int]($targetSize - $dh - 8)

    # Step 1
    $bmp1 = New-Object System.Drawing.Bitmap($targetSize, $targetSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g1 = [System.Drawing.Graphics]::FromImage($bmp1)
    $g1.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g1.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $srcRect = New-Object System.Drawing.Rectangle($minX, $minY, $bw, $bh)
    $dstRect1 = New-Object System.Drawing.Rectangle($dx, $dy, $dw, $dh)
    $g1.DrawImage($argb, $dstRect1, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g1.Dispose()

    $file1 = Join-Path $outputDir "$name-step1.png"
    $bmp1.Save($file1, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp1.Dispose()

    # Step 2: Slither / Walk animation frame
    $bmp2 = New-Object System.Drawing.Bitmap($targetSize, $targetSize, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g2 = [System.Drawing.Graphics]::FromImage($bmp2)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $step2Dw = [int]($dw * 1.03)
    $step2Dh = [int]($dh * 0.97)
    $step2Dx = [int](($targetSize - $step2Dw) / 2)
    $step2Dy = $dy + 3
    $dstRect2 = New-Object System.Drawing.Rectangle($step2Dx, $step2Dy, $step2Dw, $step2Dh)
    $g2.DrawImage($argb, $dstRect2, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    $g2.Dispose()

    $file2 = Join-Path $outputDir "$name-step2.png"
    $bmp2.Save($file2, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp2.Dispose()
}

Process-Figure "front" 0 ([int]($w * 0.35))
Process-Figure "back"  ([int]($w * 0.33)) ([int]($w * 0.67))
Process-Figure "side"  ([int]($w * 0.65)) $w

$argb.Dispose()
Write-Host "All snake avatar frames extracted successfully into $outputDir!"
