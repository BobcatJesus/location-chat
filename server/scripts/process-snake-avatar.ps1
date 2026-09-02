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

$argb = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($argb)
$g.DrawImage($srcBmp, 0, 0, $w, $h)
$g.Dispose()
$srcBmp.Dispose()

# Determine background threshold
# In the source image, the background is plain white/off-white (R>235, G>235, B>235 with low saturation)
# Snake belly is pale yellow/peach (B is much lower than R & G, e.g., R=255, G=230, B=195 -> (R-B) > 35)
# Eyes specular highlight is small white dots inside the dark eye (R,G,B < 60 surrounds them)

function IsWhiteBackground($c) {
    # Check if pixel is pure/near white and neutral (not yellowish/peachy like belly)
    $minVal = [Math]::Min($c.R, [Math]::Min($c.G, $c.B))
    $maxVal = [Math]::Max($c.R, [Math]::Max($c.G, $c.B))
    $diff = $maxVal - $minVal

    # Neutral off-white/pure white: all channels high (>= 225) and low color divergence (diff <= 18)
    if ($minVal -ge 225 -and $diff -le 20) {
        return $true
    }
    # Also near-pure white with slight compression noise (>= 215, diff <= 12)
    if ($minVal -ge 215 -and $diff -le 12) {
        return $true
    }
    return $false
}

# Flood fill from boundaries AND find enclosed background pockets (e.g. between tail and neck)
$visited = New-Object 'bool[,]' $w, $h
$queue = New-Object System.Collections.Generic.Queue[System.Drawing.Point]

# Enqueue border pixels
for ($x = 0; $x -lt $w; $x++) {
    if (IsWhiteBackground ($argb.GetPixel($x, 0))) {
        $visited[$x, 0] = $true
        $queue.Enqueue((New-Object System.Drawing.Point($x, 0)))
    }
    if (IsWhiteBackground ($argb.GetPixel($x, $h - 1))) {
        $visited[$x, $h - 1] = $true
        $queue.Enqueue((New-Object System.Drawing.Point($x, $h - 1)))
    }
}
for ($y = 0; $y -lt $h; $y++) {
    if (IsWhiteBackground ($argb.GetPixel(0, $y))) {
        $visited[0, $y] = $true
        $queue.Enqueue((New-Object System.Drawing.Point(0, $y)))
    }
    if (IsWhiteBackground ($argb.GetPixel($w - 1, $y))) {
        $visited[$w - 1, $y] = $true
        $queue.Enqueue((New-Object System.Drawing.Point($w - 1, $y)))
    }
}

while ($queue.Count -gt 0) {
    $pt = $queue.Dequeue()
    $px = $pt.X
    $py = $pt.Y
    
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
                if (IsWhiteBackground $col) {
                    $queue.Enqueue($n)
                }
            }
        }
    }
}

# Second pass: check for enclosed background holes (e.g. inside loop of tail)
# Any large connected component of IsWhiteBackground pixels that isn't inside the eye
# (Eye specular dots are small, < 30 pixels total, and surrounded by very dark brown/black pixels R,G,B < 70)
for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
        if (-not $visited[$x, $y]) {
            $col = $argb.GetPixel($x, $y)
            if (IsWhiteBackground $col) {
                # Find the full connected component of this white pocket
                $pocketQueue = New-Object System.Collections.Generic.Queue[System.Drawing.Point]
                $pocketPoints = New-Object System.Collections.Generic.List[System.Drawing.Point]
                
                $visited[$x, $y] = $true
                $pocketQueue.Enqueue((New-Object System.Drawing.Point($x, $y)))
                $pocketPoints.Add((New-Object System.Drawing.Point($x, $y)))

                while ($pocketQueue.Count -gt 0) {
                    $p = $pocketQueue.Dequeue()
                    $pNeighbors = @(
                        (New-Object System.Drawing.Point($p.X + 1, $p.Y)),
                        (New-Object System.Drawing.Point($p.X - 1, $p.Y)),
                        (New-Object System.Drawing.Point($p.X, $p.Y + 1)),
                        (New-Object System.Drawing.Point($p.X, $p.Y - 1))
                    )
                    foreach ($pn in $pNeighbors) {
                        if ($pn.X -ge 0 -and $pn.X -lt $w -and $pn.Y -ge 0 -and $pn.Y -lt $h) {
                            if (-not $visited[$pn.X, $pn.Y]) {
                                $visited[$pn.X, $pn.Y] = $true
                                $pnCol = $argb.GetPixel($pn.X, $pn.Y)
                                if (IsWhiteBackground $pnCol) {
                                    $pocketQueue.Enqueue($pn)
                                    $pocketPoints.Add($pn)
                                }
                            }
                        }
                    }
                }

                # If the pocket has more than 150 pixels, it's definitely an enclosed background pocket, not an eye specular highlight!
                if ($pocketPoints.Count -gt 150) {
                    foreach ($p in $pocketPoints) {
                        $argb.SetPixel($p.X, $p.Y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
                    }
                }
            }
        }
    }
}

# Edge cleanup: feather/defringe near-white border halos
for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
        $col = $argb.GetPixel($x, $y)
        if ($col.A -gt 0) {
            $minVal = [Math]::Min($col.R, [Math]::Min($col.G, $col.B))
            $maxVal = [Math]::Max($col.R, [Math]::Max($col.G, $col.B))
            $diff = $maxVal - $minVal

            if ($minVal -ge 210 -and $diff -le 25) {
                # Check if touching transparent pixel
                $isBorder = $false
                for ($dy = -1; $dy -le 1; $dy++) {
                    for ($dx = -1; $dx -le 1; $dx++) {
                        $nx = $x + $dx
                        $ny = $y + $dy
                        if ($nx -ge 0 -and $nx -lt $w -and $ny -ge 0 -and $ny -lt $h) {
                            if ($argb.GetPixel($nx, $ny).A -eq 0) {
                                $isBorder = $true
                                break
                            }
                        }
                    }
                    if ($isBorder) { break }
                }

                if ($isBorder) {
                    $argb.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
                }
            }
        }
    }
}

Write-Host "Defringing complete."

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
Write-Host "All snake avatar frames cleanly extracted into $outputDir!"
