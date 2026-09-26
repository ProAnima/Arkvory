param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$tokens = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../../branding/identity.json') -Raw | ConvertFrom-Json
$bitmap = [Drawing.Bitmap]::new($tokens.width, $tokens.height)
$graphics = [Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
function Brush([string]$value) { [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($value)) }
$background = Brush $tokens.background
$accent = Brush $tokens.accent
$text = Brush $tokens.text
$muted = Brush $tokens.muted
$pen = [Drawing.Pen]::new([Drawing.ColorTranslator]::FromHtml($tokens.border), 2)
$title = [Drawing.Font]::new($tokens.font, 48, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
$small = [Drawing.Font]::new($tokens.font, 20, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
try {
  $graphics.FillRectangle($background, 0, 0, $tokens.width, $tokens.height)
  $mark = [Drawing.Drawing2D.GraphicsPath]::new([Drawing.Drawing2D.FillMode]::Alternate)
  foreach ($polygon in $tokens.polygons) {
    $points = [Drawing.PointF[]]@($polygon | ForEach-Object { [Drawing.PointF]::new(44 + $_[0]*2.6,60 + $_[1]*2.6) })
    $mark.AddPolygon($points)
  }
  $graphics.FillPath($accent, $mark)
  $mark.Dispose()
  $graphics.DrawString($tokens.name, $title, $text, 56, 230)
  $graphics.DrawString('PROANIMA STUDIO', $small, $muted, 60, 300)
  $graphics.FillRectangle($accent, 60, 360, 72, 5)
  $graphics.DrawString('UPACK  /  FILE STORAGE', $small, $muted, 60, 404)
  for ($i=0; $i -lt 5; $i++) {
    $offset = 40 * $i
    $graphics.DrawLines($pen, [Drawing.PointF[]]@([Drawing.PointF]::new(130,610+$offset),[Drawing.PointF]::new(310,500+$offset),[Drawing.PointF]::new(540,640+$offset)))
  }
  $graphics.DrawString('IAN PANAEV', $small, $muted, 60, 866)
  $bitmap.Save((Join-Path $Output 'wizard.png'), [Drawing.Imaging.ImageFormat]::Png)
} finally {
  foreach ($item in @($graphics,$bitmap,$background,$accent,$text,$muted,$pen,$title,$small)) { $item.Dispose() }
}
