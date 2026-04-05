@echo off
echo.
echo ===================================================
echo      PLANER: ADHD VIZUALNI PROJEKTOVY SPRAVCE
echo ===================================================
echo.
echo Spoustim lokalni server...
echo.

:: Otevře prohlížeč na patřičné adrese s malým zpožděním aby se server stihl zapnout
start http://localhost:8080

:: Zapne Python HTTP Server s novým backendem
python server.py

pause
