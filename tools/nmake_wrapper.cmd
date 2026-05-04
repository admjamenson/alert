@echo off
setlocal enabledelayedexpansion

set "NMAKE_EXE=%ALERT_NMAKE%"
if not defined NMAKE_EXE (
  set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
  if exist "!VSWHERE!" (
    for /f "usebackq delims=" %%I in (`"!VSWHERE!" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -find VC\Tools\MSVC\**\bin\Hostx86\x64\nmake.exe`) do (
      if not defined NMAKE_EXE set "NMAKE_EXE=%%I"
    )
  )
)
if not defined NMAKE_EXE set "NMAKE_EXE=C:\PROGRA~2\MICROS~2\2022\BUILDT~1\VC\Tools\MSVC\14.44.35207\bin\Hostx86\x64\nmake.exe"

if not exist "%NMAKE_EXE%" (
  echo NMake executable not found. Set ALERT_NMAKE to the full nmake.exe path. 1>&2
  exit /b 1
)

if /I "%~1"=="-C" (
  set "WORKDIR=%~2"
  if not exist "!WORKDIR!\." (
    echo NMake working directory not found: !WORKDIR! 1>&2
    exit /b 1
  )
  pushd "!WORKDIR!" >nul
  "%NMAKE_EXE%" %3 %4 %5 %6 %7 %8 %9
  set "EXITCODE=!ERRORLEVEL!"
  popd >nul
  exit /b !EXITCODE!
)
"%NMAKE_EXE%" %*

