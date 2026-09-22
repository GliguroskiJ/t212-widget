!macro customUnInstall
  ; remove the "Start with Windows" entry the app created
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "cz.jovan.t212widget"
!macroend
