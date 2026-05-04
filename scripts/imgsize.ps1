Add-Type -AssemblyName System.Drawing
 = @(
  'c:\\Alert\\android\\app\\src\\main\\res\\drawable-nodpi\\widget_preview_small_1.png',
  'c:\\Alert\\android\\app\\src\\main\\res\\drawable-nodpi\\widget_preview_small_2.png',
  'c:\\Alert\\android\\app\\src\\main\\res\\drawable-nodpi\\widget_preview_medium.png',
  'c:\\Alert\\android\\app\\src\\main\\res\\drawable-nodpi\\widget_preview_large.png'
)
foreach ( in ) {
   = [System.Drawing.Image]::FromFile()
  Write-Output ( x)
  .Dispose()
}
