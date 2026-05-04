@echo off
set GRADLE_USER_HOME=c:\Alert\gradlehome
cd /d c:\Alert\android
call gradlew.bat :react-native-reanimated:externalNativeBuildRelease --no-daemon --console=plain --stacktrace

