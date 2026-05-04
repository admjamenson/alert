$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = 'C:\Users\prjam\Downloads\1 (1).png'
$sizes = @{
  'mipmap-mdpi' = 48
  'mipmap-hdpi' = 72
  'mipmap-xhdpi' = 96
  'mipmap-xxhdpi' = 144
  'mipmap-xxxhdpi' = 192
}

foreach ($entry in $sizes.GetEnumerator()) {
  $dir = Join-Path 'C:\Alert\android\app\src\main\res' $entry.Key
  $size = [int]$entry.Value

  $img = [System.Drawing.Image]::FromFile($src)
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)

  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($img, 0, 0, $size, $size)

  $out1 = Join-Path $dir 'ic_launcher.png'
  $out2 = Join-Path $dir 'ic_launcher_round.png'
  $bmp.Save($out1, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Save($out2, [System.Drawing.Imaging.ImageFormat]::Png)

  $g.Dispose()
  $bmp.Dispose()
  $img.Dispose()
}
