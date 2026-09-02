Add-Type -AssemblyName System.Drawing

$srcBmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path "public\avatars\source\snake_source.png").Path)
$w = $srcBmp.Width
$h = $srcBmp.Height
Write-Host "Size: ${w}x${h}"

for ($y = 0; $y -lt $h; $y += 200) {
    for ($x = 0; $x -lt $w; $x += 400) {
        $p = $srcBmp.GetPixel($x, $y)
        Write-Host "($x,$y): R=$($p.R) G=$($p.G) B=$($p.B)"
    }
}

$srcBmp.Dispose()
