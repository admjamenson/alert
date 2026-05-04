$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

function New-RoundedRectPath($x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    return $path
}

function Get-ThemePalette($theme) {
    if ($theme -eq 'light') {
        return @{
            Bg = [System.Drawing.Color]::FromArgb(0xF2,0xF5,0xF9)
            Text = [System.Drawing.Color]::FromArgb(0x0B,0x12,0x22)
            Muted = [System.Drawing.Color]::FromArgb(0x48,0x55,0x6B)
            PillText = [System.Drawing.Color]::White
        }
    }
    return @{
        Bg = [System.Drawing.Color]::FromArgb(0x0B,0x12,0x22)
        Text = [System.Drawing.Color]::White
        Muted = [System.Drawing.Color]::FromArgb(0xA7,0xB4,0xCC)
        PillText = [System.Drawing.Color]::White
    }
}

function Draw-WidgetSmall($path, $locale, $theme) {
    $w = 360; $h = 360
    $palette = Get-ThemePalette $theme
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'HighQuality'
    $g.Clear($palette.Bg)

    $rectPath = New-RoundedRectPath 8 8 ($w-16) ($h-16) 36
    $g.FillPath((New-Object System.Drawing.SolidBrush $palette.Bg), $rectPath)

    $accentRed = [System.Drawing.Color]::FromArgb(0xD9,0x1F,0x2A)
    $green = [System.Drawing.Color]::FromArgb(0x57,0xE0,0x6F)
    $pillGreen = [System.Drawing.Color]::FromArgb(0x2D,0x7B,0x3F)

    $fontTitle = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Bold)
    $fontMetric = New-Object System.Drawing.Font('Segoe UI', 54, [System.Drawing.FontStyle]::Bold)
    $fontPill = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)

    # Logo
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $accentRed), 28, 28, 26, 26)
    $g.DrawString('A', (New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)), (New-Object System.Drawing.SolidBrush $palette.Text), 32, 28)

    # Alert icon (triangle)
    $triBrush = New-Object System.Drawing.SolidBrush $accentRed
    $points = @(
        [System.Drawing.Point]::new($w-52, 30),
        [System.Drawing.Point]::new($w-28, 30),
        [System.Drawing.Point]::new($w-40, 52)
    )
    $g.FillPolygon($triBrush, $points)

    $title = if ($locale -eq 'pt') { 'Status' } else { 'Status' }
    $g.DrawString($title, $fontTitle, (New-Object System.Drawing.SolidBrush $palette.Text), 28, 70)

    # Ring
    $ringPen = New-Object System.Drawing.Pen $green, 10
    $g.DrawEllipse($ringPen, 90, 130, 180, 180)
    $g.DrawString('18', $fontMetric, (New-Object System.Drawing.SolidBrush $palette.Text), 128, 165)

    $pillText = if ($locale -eq 'pt') { 'Atenção na área' } else { 'Attention nearby' }
    $pillRect = New-Object System.Drawing.Rectangle 70, 320, 220, 32
    $pillPath = New-RoundedRectPath $pillRect.X $pillRect.Y $pillRect.Width $pillRect.Height 16
    $g.FillPath((New-Object System.Drawing.SolidBrush $pillGreen), $pillPath)
    $g.DrawString($pillText, $fontPill, (New-Object System.Drawing.SolidBrush $palette.PillText), 90, 323)

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

function Draw-WidgetSmallAlt($path, $locale, $theme) {
    $w = 360; $h = 360
    $palette = Get-ThemePalette $theme
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'HighQuality'
    $g.Clear($palette.Bg)
    $rectPath = New-RoundedRectPath 8 8 ($w-16) ($h-16) 36
    $g.FillPath((New-Object System.Drawing.SolidBrush $palette.Bg), $rectPath)

    $accentRed = [System.Drawing.Color]::FromArgb(0xD9,0x1F,0x2A)
    $green = [System.Drawing.Color]::FromArgb(0x57,0xE0,0x6F)
    $pillGreen = [System.Drawing.Color]::FromArgb(0x2D,0x7B,0x3F)

    $fontTitle = New-Object System.Drawing.Font('Segoe UI', 30, [System.Drawing.FontStyle]::Bold)
    $fontMetric = New-Object System.Drawing.Font('Segoe UI', 54, [System.Drawing.FontStyle]::Bold)
    $fontSub = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Regular)
    $fontPill = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)

    # Logo
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $accentRed), 28, 28, 26, 26)
    $g.DrawString('A', (New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)), (New-Object System.Drawing.SolidBrush $palette.Text), 32, 28)

    $title = if ($locale -eq 'pt') { 'Rota' } else { 'Route' }
    $g.DrawString($title, $fontTitle, (New-Object System.Drawing.SolidBrush $palette.Text), 28, 70)

    $g.DrawString('10', $fontMetric, (New-Object System.Drawing.SolidBrush $palette.Text), 28, 120)
    $g.DrawString('m', $fontSub, (New-Object System.Drawing.SolidBrush $palette.Text), 125, 165)

    $dest = if ($locale -eq 'pt') { 'Teste' } else { 'Test' }
    $g.DrawString($dest, $fontSub, (New-Object System.Drawing.SolidBrush $palette.Text), 28, 200)

    # simple diamond icon
    $diamond = @(
        [System.Drawing.Point]::new(70, 240),
        [System.Drawing.Point]::new(85, 255),
        [System.Drawing.Point]::new(70, 270),
        [System.Drawing.Point]::new(55, 255)
    )
    $g.FillPolygon((New-Object System.Drawing.SolidBrush $green), $diamond)

    $pillText = if ($locale -eq 'pt') { 'Sem alertas' } else { 'No alerts' }
    $pillRect = New-Object System.Drawing.Rectangle 70, 320, 220, 32
    $pillPath = New-RoundedRectPath $pillRect.X $pillRect.Y $pillRect.Width $pillRect.Height 16
    $g.FillPath((New-Object System.Drawing.SolidBrush $pillGreen), $pillPath)
    $g.DrawString($pillText, $fontPill, (New-Object System.Drawing.SolidBrush $palette.PillText), 120, 323)

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

function Draw-WidgetMedium($path, $locale, $theme) {
    $w = 600; $h = 260
    $palette = Get-ThemePalette $theme
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'HighQuality'
    $g.Clear($palette.Bg)
    $rectPath = New-RoundedRectPath 8 8 ($w-16) ($h-16) 36
    $g.FillPath((New-Object System.Drawing.SolidBrush $palette.Bg), $rectPath)

    $accentRed = [System.Drawing.Color]::FromArgb(0xD9,0x1F,0x2A)
    $green = [System.Drawing.Color]::FromArgb(0x57,0xE0,0x6F)

    $fontSmall = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
    $fontTitle = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Bold)
    $fontMetric = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Bold)

    $g.FillEllipse((New-Object System.Drawing.SolidBrush $accentRed), 28, 24, 22, 22)
    $g.DrawString('A', $fontSmall, (New-Object System.Drawing.SolidBrush $palette.Text), 30, 20)

    # ring
    $ringPen = New-Object System.Drawing.Pen $green, 8
    $g.DrawEllipse($ringPen, 36, 80, 90, 90)
    $g.DrawString('18', $fontMetric, (New-Object System.Drawing.SolidBrush $palette.Text), 58, 102)

    $title = if ($locale -eq 'pt') { 'Atenção local' } else { 'Local attention' }
    $g.DrawString($title, $fontTitle, (New-Object System.Drawing.SolidBrush $palette.Text), 150, 110)

    # info icon
    $g.DrawEllipse((New-Object System.Drawing.Pen $palette.Muted, 3), 540, 100, 26, 26)
    $g.DrawString('i', $fontSmall, (New-Object System.Drawing.SolidBrush $palette.Muted), 548, 96)

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

function Draw-WidgetLarge($path, $locale, $theme) {
    $w = 600; $h = 360
    $palette = Get-ThemePalette $theme
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'HighQuality'
    $g.Clear($palette.Bg)
    $rectPath = New-RoundedRectPath 8 8 ($w-16) ($h-16) 36
    $g.FillPath((New-Object System.Drawing.SolidBrush $palette.Bg), $rectPath)

    $accentRed = [System.Drawing.Color]::FromArgb(0xD9,0x1F,0x2A)
    $green = [System.Drawing.Color]::FromArgb(0x57,0xE0,0x6F)
    $pillGreen = [System.Drawing.Color]::FromArgb(0x2D,0x7B,0x3F)

    $fontSmall = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
    $fontTitle = New-Object System.Drawing.Font('Segoe UI', 28, [System.Drawing.FontStyle]::Bold)
    $fontPill = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)

    $g.FillEllipse((New-Object System.Drawing.SolidBrush $accentRed), 28, 24, 22, 22)
    $g.DrawString('A', $fontSmall, (New-Object System.Drawing.SolidBrush $palette.Text), 30, 20)

    $title = if ($locale -eq 'pt') { 'Status local' } else { 'Local status' }
    $g.DrawString($title, $fontTitle, (New-Object System.Drawing.SolidBrush $palette.Text), 80, 40)

    # bars
    $barWidth = 70; $gap = 12
    $x = 80
    for ($i=0; $i -lt 5; $i++) {
        $hgt = 120 + (10 * ($i % 2))
        $g.FillRectangle((New-Object System.Drawing.SolidBrush $green), $x, 120, $barWidth, $hgt)
        $x += $barWidth + $gap
    }

    # locator icon
    $g.DrawEllipse((New-Object System.Drawing.Pen $green, 4), 290, 260, 26, 26)
    $g.FillEllipse((New-Object System.Drawing.SolidBrush $green), 300, 270, 6, 6)

    $pillText = if ($locale -eq 'pt') { 'Atenção na área' } else { 'Attention nearby' }
    $pillRect = New-Object System.Drawing.Rectangle 220, 305, 180, 32
    $pillPath = New-RoundedRectPath $pillRect.X $pillRect.Y $pillRect.Width $pillRect.Height 16
    $g.FillPath((New-Object System.Drawing.SolidBrush $pillGreen), $pillPath)
    $g.DrawString($pillText, $fontPill, (New-Object System.Drawing.SolidBrush $palette.PillText), 238, 308)

    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

$base = 'c:\Alert\android\app\src\main\res'
$drawable = Join-Path $base 'drawable'
$drawableNight = Join-Path $base 'drawable-night'
$drawablePt = Join-Path $base 'drawable-pt'
$drawablePtNight = Join-Path $base 'drawable-pt-night'

New-Item -ItemType Directory -Force -Path $drawable | Out-Null
New-Item -ItemType Directory -Force -Path $drawableNight | Out-Null
New-Item -ItemType Directory -Force -Path $drawablePt | Out-Null
New-Item -ItemType Directory -Force -Path $drawablePtNight | Out-Null

# Light (default)
Draw-WidgetSmall (Join-Path $drawable 'widget_preview_small.png') 'en' 'light'
Draw-WidgetSmallAlt (Join-Path $drawable 'widget_preview_small_alt.png') 'en' 'light'
Draw-WidgetMedium (Join-Path $drawable 'widget_preview_medium.png') 'en' 'light'
Draw-WidgetLarge (Join-Path $drawable 'widget_preview_large.png') 'en' 'light'

# Light PT
Draw-WidgetSmall (Join-Path $drawablePt 'widget_preview_small.png') 'pt' 'light'
Draw-WidgetSmallAlt (Join-Path $drawablePt 'widget_preview_small_alt.png') 'pt' 'light'
Draw-WidgetMedium (Join-Path $drawablePt 'widget_preview_medium.png') 'pt' 'light'
Draw-WidgetLarge (Join-Path $drawablePt 'widget_preview_large.png') 'pt' 'light'

# Dark
Draw-WidgetSmall (Join-Path $drawableNight 'widget_preview_small.png') 'en' 'dark'
Draw-WidgetSmallAlt (Join-Path $drawableNight 'widget_preview_small_alt.png') 'en' 'dark'
Draw-WidgetMedium (Join-Path $drawableNight 'widget_preview_medium.png') 'en' 'dark'
Draw-WidgetLarge (Join-Path $drawableNight 'widget_preview_large.png') 'en' 'dark'

# Dark PT
Draw-WidgetSmall (Join-Path $drawablePtNight 'widget_preview_small.png') 'pt' 'dark'
Draw-WidgetSmallAlt (Join-Path $drawablePtNight 'widget_preview_small_alt.png') 'pt' 'dark'
Draw-WidgetMedium (Join-Path $drawablePtNight 'widget_preview_medium.png') 'pt' 'dark'
Draw-WidgetLarge (Join-Path $drawablePtNight 'widget_preview_large.png') 'pt' 'dark'
