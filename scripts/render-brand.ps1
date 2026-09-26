$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot
$brand = Get-Content -LiteralPath (Join-Path $root 'branding/identity.json') -Raw | ConvertFrom-Json
function Color([string]$hex) { [Drawing.ColorTranslator]::FromHtml($hex) }
foreach ($variant in @('arkvory','arkvory-cli','arkvory-remote')) {
  $images = [Collections.Generic.List[byte[]]]::new()
  $sizes = @(16,24,32,48,64,128,256)
  foreach ($size in $sizes) {
    $canvas = [Drawing.Bitmap]::new($size * 4, $size * 4)
    $g = [Drawing.Graphics]::FromImage($canvas)
    $g.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.ScaleTransform($size / 16, $size / 16)
    $tile = [Drawing.Drawing2D.GraphicsPath]::new()
    $diameter = $brand.radius * 2
    $tile.AddArc(0,0,$diameter,$diameter,180,90)
    $tile.AddArc(64-$diameter,0,$diameter,$diameter,270,90)
    $tile.AddArc(64-$diameter,64-$diameter,$diameter,$diameter,0,90)
    $tile.AddArc(0,64-$diameter,$diameter,$diameter,90,90)
    $tile.CloseFigure()
    $gradient = [Drawing.Drawing2D.LinearGradientBrush]::new([Drawing.Point]::new(0,0),[Drawing.Point]::new(64,64),(Color $brand.gradientStart),(Color $brand.accent))
    $ink = [Drawing.SolidBrush]::new((Color $brand.ink))
    $g.FillPath($gradient,$tile)
    $mark = [Drawing.Drawing2D.GraphicsPath]::new([Drawing.Drawing2D.FillMode]::Alternate)
    foreach ($polygon in $brand.polygons) {
      $points = [Drawing.PointF[]]@($polygon | ForEach-Object { [Drawing.PointF]::new($_[0],$_[1]) })
      $mark.AddPolygon($points)
    }
    $g.FillPath($ink,$mark)
    $pen = [Drawing.Pen]::new((Color $brand.accent),2)
    $pen.StartCap = [Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [Drawing.Drawing2D.LineCap]::Round
    $pen.LineJoin = [Drawing.Drawing2D.LineJoin]::Round
    if ($variant -ne 'arkvory') {
      $badge = [Drawing.Drawing2D.GraphicsPath]::new()
      $badge.AddArc(38,37,14,14,180,90)
      $badge.AddArc(48,37,14,14,270,90)
      $badge.AddArc(48,46,14,14,0,90)
      $badge.AddArc(38,46,14,14,90,90)
      $badge.CloseFigure()
      $g.FillPath($ink,$badge)
      $badge.Dispose()
      if ($variant -eq 'arkvory-cli') {
        $g.DrawLines($pen,[Drawing.PointF[]]@([Drawing.PointF]::new(44,43),[Drawing.PointF]::new(48,47),[Drawing.PointF]::new(44,51)))
        $g.DrawLine($pen,51,51,56,51)
      } else {
        $g.DrawLine($pen,44,48,56,48)
        $g.DrawLines($pen,[Drawing.PointF[]]@([Drawing.PointF]::new(52,44),[Drawing.PointF]::new(56,48),[Drawing.PointF]::new(52,52)))
      }
    }
    $bitmap = [Drawing.Bitmap]::new($size,$size)
    $scaled = [Drawing.Graphics]::FromImage($bitmap)
    $scaled.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $scaled.DrawImage($canvas,0,0,$size,$size)
    $stream = [IO.MemoryStream]::new()
    $bitmap.Save($stream,[Drawing.Imaging.ImageFormat]::Png)
    $images.Add($stream.ToArray())
    if ($size -eq 256) { [IO.File]::WriteAllBytes((Join-Path $root "branding/icons/$variant.png"),$stream.ToArray()) }
    foreach ($resource in @($stream,$scaled,$bitmap,$pen,$mark,$ink,$gradient,$tile,$g,$canvas)) { $resource.Dispose() }
  }
  # ICO directory holds independently encoded PNG frames, including the 256px high-DPI frame.
  $file = [IO.File]::Create((Join-Path $root "branding/icons/$variant.ico"))
  $writer = [IO.BinaryWriter]::new($file)
  try {
    $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i=0; $i -lt $sizes.Count; $i++) {
      $dimension = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
      $writer.Write([byte]$dimension); $writer.Write([byte]$dimension)
      $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]32)
      $writer.Write([uint32]$images[$i].Length); $writer.Write([uint32]$offset)
      $offset += $images[$i].Length
    }
    foreach ($bytes in $images) { $writer.Write($bytes) }
  } finally { $writer.Dispose(); $file.Dispose() }
}
