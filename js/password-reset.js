// Passwörter bleiben bei Supabase Auth. Diese Datei entscheidet nur die Oberfläche.
export const PASSWORD_MIN_LENGTH=12;
export const PASSWORD_RESET_REDIRECT='https://maximus3039.github.io/tageswerk-test/?vorgang=passwort';
export const RESET_SENT_MESSAGE='Wenn ein Konto zu dieser E-Mail-Adresse besteht, wurde ein Link zum Zurücksetzen gesendet. Bitte auch den Spam-Ordner prüfen.';
export const EMAIL_INVALID_MESSAGE='Bitte eine gültige E-Mail-Adresse eingeben.';
export const PASSWORD_SHORT_MESSAGE='Bitte ein Passwort mit mindestens 12 Zeichen eingeben.';
export const PASSWORD_MISMATCH_MESSAGE='Die beiden Passwörter stimmen nicht überein.';
export const RECOVERY_EXPIRED_MESSAGE='Der Wiederherstellungslink ist abgelaufen. Bitte einen neuen Link anfordern.';
export const RECOVERY_INVALID_MESSAGE='Der Wiederherstellungslink ist ungültig. Bitte einen neuen Link anfordern.';
export const PASSWORD_SAVED_MESSAGE='Das Passwort wurde gespeichert. Bitte mit dem neuen Passwort anmelden.';
export const RESET_RATE_MESSAGE='Bitte einen Moment warten und es dann erneut versuchen.';
export const RESET_FAILED_MESSAGE='Der Link konnte gerade nicht gesendet werden. Bitte es erneut versuchen.';
export const RECOVERY_SAVE_FAILED_MESSAGE='Das Passwort konnte nicht gespeichert werden. Bitte einen neuen Link anfordern.';

export function readAuthCallback(locationLike){
 const hash=new URLSearchParams(String(locationLike?.hash||'').replace(/^#/,''));
 const query=new URLSearchParams(String(locationLike?.search||'').replace(/^\?/,''));
 const type=hash.get('type')||query.get('type')||'';
 const error=hash.get('error')||query.get('error')||'';
 const errorCode=hash.get('error_code')||query.get('error_code')||'';
 const errorDescription=hash.get('error_description')||query.get('error_description')||'';
 return {
  type,
  error,
  errorCode,
  errorDescription,
  recoveryMarked:type==='recovery'||query.get('vorgang')==='passwort',
  hasCredential:Boolean(hash.get('access_token')||query.get('code'))
 };
}

export function linkProblem(callback){
 if(!callback?.error&&!callback?.errorCode&&!callback?.errorDescription)return '';
 const description=safeText(callback.errorDescription);
 if(callback.errorCode==='otp_expired'||/expir|abgelaufen/i.test(description))return 'expired';
 return 'invalid';
}

export function screenForAuth({callback,user,recoveryFlow,recoveryDone,passwordRequestOpen}){
 if(recoveryDone)return 'recovery-done';
 if(callback?.type==='invite'&&user&&!recoveryFlow)return 'invite';
 const marked=Boolean(recoveryFlow||callback?.type==='recovery'||callback?.recoveryMarked);
 if(marked){
  const problem=linkProblem(callback);
  if(problem==='expired')return 'recovery-expired';
  if(problem)return 'recovery-invalid';
  if(user&&(recoveryFlow||callback?.type==='recovery'||callback?.hasCredential))return 'recovery';
  return 'recovery-invalid';
 }
 if(!user&&passwordRequestOpen)return 'password-request';
 return user?'app':'login';
}

export function recoveryAllowsSave(user,recoveryActive){
 return Boolean(user&&recoveryActive);
}

export function passwordResetEmail(value){
 const email=String(value||'').trim();
 if(email.length>320||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return '';
 return email;
}

export function passwordChoice(password,confirmation){
 const next=String(password??'');
 const again=String(confirmation??'');
 if(next.length<PASSWORD_MIN_LENGTH)return {ok:false,message:PASSWORD_SHORT_MESSAGE};
 if(next!==again)return {ok:false,message:PASSWORD_MISMATCH_MESSAGE};
 return {ok:true,password:next};
}

export function resetRequestOutcome(error){
 if(!error)return {ok:true,message:RESET_SENT_MESSAGE};
 const text=String(error.message||error.code||error.error_code||'').toLowerCase();
 if(/user not found|not found|not registered|no user|email address not|signups not allowed/.test(text))return {ok:true,message:RESET_SENT_MESSAGE};
 if(/rate|too many|over_request|429/.test(text))return {ok:false,message:RESET_RATE_MESSAGE};
 return {ok:false,message:RESET_FAILED_MESSAGE};
}

export function recoveryFailure(error){
 const text=String(error?.message||'');
 if(/password/i.test(text))return 'Das Passwort erfüllt die Vorgaben nicht. Bitte mindestens 12 Zeichen verwenden.';
 if(/session|expired|invalid|jwt|token|otp|abgelaufen|ungültig/i.test(text))return RECOVERY_INVALID_MESSAGE;
 return RECOVERY_SAVE_FAILED_MESSAGE;
}

export function inviteCallbackMessage(callback){
 if(!callback||callback.type==='recovery'||callback.recoveryMarked)return '';
 if(!callback.error&&!callback.errorCode&&!callback.errorDescription)return '';
 const description=safeText(callback.errorDescription).replace(/\s+/g,' ').slice(0,180);
 return description?'Einladungslink ungültig oder abgelaufen: '+description:'Einladungslink ungültig oder abgelaufen.';
}

export function callbackNotice(callback,screen){
 if(screen==='recovery-expired')return RECOVERY_EXPIRED_MESSAGE;
 if(screen==='recovery-invalid')return RECOVERY_INVALID_MESSAGE;
 if(screen==='login')return inviteCallbackMessage(callback);
 return '';
}

function safeText(value){
 const text=String(value||'').replace(/\+/g,' ');
 try{return decodeURIComponent(text);}
 catch{return text;}
}
