Add-Type -AssemblyName System.Drawing

$srcBmp = [System.Drawing.Bitmap]::FromFile((Resolve-Path "public\avatars\source\snake_source.png").Path)
$w = $srcBmp.Width
$h = $srcBmp.Height

Write-Host "Image size: ${w}x${h}"

# Check color palette of the snake:
# Snake body: mint green (e.g., R ~ 180-220, G ~ 215-245, B ~ 180-220)
# Snake belly: cream/yellow (R ~ 240-255, G ~ 230-245, B ~ 190-215)
# Snake outline: dark brownish/black (R, G, B < 60)
# Snake cheeks/blush: pink (R ~ 240-255, G ~ 180-210, B ~ 180-210)
# Snake eyes: dark brown / pupils with small specular white dots
# Background: white / near-white (#ffffff, #fdfdfd, #fefefe, etc.)
# But note: enclosed spaces (like between the tail curve and body) might not be reached by external flood fill!

$argb = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($argb)
$g.DrawImage($srcBmp, 0, 0, $w, $h)
$g.Dispose()
$srcBmp.Dispose()

# Sample pixels inside the loops/curves of the snake in front view (x: 0..850)
for ($y = 0; $y -lt $h; $y += 50) {
    for ($x = 0; $x -lt 850; $x += 50) {
        $c = $argb.GetPixel($x, $y)
        if ($c.R -gt 240 -and $c.G -gt 240 -and $c.B -gt 240) {
            # White pixel
        }
    }
}

Write-Host "Script analysis complete."
