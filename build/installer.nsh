!macro customInit
  ; চেক করা হচ্ছে আগের ভার্সন ইন্সটল করা আছে কি না (Current User)
  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "UninstallString"
  StrCmp $R0 "" check_local_machine
  
  ; আনইন্সটলার সাইলেন্টলি রান করা
  ExecWait '$R0 /S _?=$INSTDIR'
  Goto done

check_local_machine:
  ; চেক করা হচ্ছে আগের ভার্সন ইন্সটল করা আছে কি না (All Users)
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_GUID}" "UninstallString"
  StrCmp $R0 "" done

  ; আনইন্সটলার রান করা
  ExecWait '$R0 /S _?=$INSTDIR'

done:
!macroend