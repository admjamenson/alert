@echo off
set GRADLE_USER_HOME=c:\Alert\gradlehome
cd /d c:\Alert\android
call gradlew.bat assembleRelease --no-daemon --console=plain --stacktrace --warning-mode all

