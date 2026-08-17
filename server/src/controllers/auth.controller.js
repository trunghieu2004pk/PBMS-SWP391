import * as authService from '../services/auth.service.js';
import { asyncHandler, successResponse, AppError } from '../utils/helpers.js';
import { isGoogleConfigured } from '../utils/google.js';

export const register = asyncHandler(async (req, res) => {
  const { username, password, fullName, email, phone } = req.body;
  // message nằm ở vỏ envelope, không lặp lại trong data.
  const { message, ...data } = await authService.register({
    username,
    password,
    fullName,
    email,
    phone,
  });
  successResponse(res, data, message, 201);
});

export const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const result = await authService.login({ username, password });
  successResponse(res, result, 'Login successful');
});

export const getMe = asyncHandler(async (req, res) => {
  const user = await authService.getMe(req.user.user_id);
  successResponse(res, user, 'Profile retrieved');
});

export const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateMe(req.user.user_id, req.body);
  successResponse(res, user, 'Đã cập nhật hồ sơ');
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const { message } = await authService.forgotPassword({ email: req.body.email });
  successResponse(res, null, message);
});

export const resetPassword = asyncHandler(async (req, res) => {
  const { message } = await authService.resetPassword({
    email: req.body.email,
    token: req.body.token,
    newPassword: req.body.newPassword,
  });
  successResponse(res, null, message);
});

export const googleLogin = asyncHandler(async (req, res) => {
  const result = await authService.loginWithGoogle({ idToken: req.body.idToken });
  successResponse(
    res,
    result,
    result.isNew ? 'Tạo tài khoản Google thành công' : 'Đăng nhập Google thành công',
  );
});

export const verifyEmail = asyncHandler(async (req, res) => {
  const { message } = await authService.verifyEmail({ email: req.body.email, token: req.body.token });
  successResponse(res, null, message);
});

export const resendVerification = asyncHandler(async (req, res) => {
  const { message } = await authService.resendVerification({ email: req.body.email });
  successResponse(res, null, message);
});

// message được nội suy thẳng vào HTML — escape để lỗi bất ngờ (vd chứa ký tự < >) không
// thành markup sống trên trang.
const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

// Trang HTML hiển thị khi user BẤM link trong email (request GET). Trả HTML thay vì JSON.
const verifyResultPage = (ok, message) => `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PBMS — Xác minh email</title></head>
<body style="font-family:Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#f1f5f9">
  <div style="background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.08);max-width:420px;text-align:center">
    <div style="font-size:48px">${ok ? '✅' : '❌'}</div>
    <h2 style="color:${ok ? '#16a34a' : '#dc2626'};margin:12px 0">${escapeHtml(message)}</h2>
    <p style="color:#64748b">Bạn có thể đóng tab này và đăng nhập vào PBMS.</p>
  </div>
</body></html>`;

export const verifyEmailPage = async (req, res) => {
  res.removeHeader('Content-Security-Policy'); // cho phép style inline ở production
  try {
    const result = await authService.verifyEmail({ email: req.query.email, token: req.query.token });
    res.status(200).type('html').send(verifyResultPage(true, result.message));
  } catch (err) {
    res.status(400).type('html').send(verifyResultPage(false, err.message || 'Xác minh email thất bại'));
  }
};

// Trang test đăng nhập Google — CHỈ chạy ở môi trường dev (404 ở production).
// BE chưa có FE tích hợp vẫn test được API: bấm nút Google → lấy ID token thật
// → trang tự POST /api/auth/google và in response; token cũng copy được để thử trong Swagger.
const googleTestHtml = (clientId) => `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PBMS — Test đăng nhập Google (dev)</title>
<script src="https://accounts.google.com/gsi/client" async defer></script></head>
<body style="font-family:Arial,sans-serif;margin:0;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center">
  <div style="background:#fff;padding:32px 40px;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.08);max-width:640px;width:100%">
    <h2 style="margin-top:0">Test <code>POST /api/auth/google</code></h2>
    ${clientId
      ? `<ol style="color:#475569;font-size:14px;line-height:1.6">
          <li>Origin này (cổng của BE) phải nằm trong <b>Authorized JavaScript origins</b> của OAuth Client trên Google Cloud Console.</li>
          <li>Bấm nút Google bên dưới → trang tự gọi API và in kết quả.</li>
        </ol>
        <div id="g_id_onload" data-client_id="${clientId}" data-callback="onCredential" data-auto_prompt="false"></div>
        <div class="g_id_signin" data-type="standard" data-size="large" data-text="signin_with"></div>
        <button id="oneTapBtn" style="margin-top:8px;padding:6px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer">🔔 Mở prompt One Tap thủ công (nếu nút trên bị chặn)</button>`
      : `<p style="color:#dc2626"><b>GOOGLE_CLIENT_ID</b> chưa được cấu hình trong <code>server/.env</code> — thêm rồi khởi động lại server.</p>`}
    <h3 style="margin-bottom:4px">ID token (copy để thử trong Swagger)</h3>
    <textarea id="token" rows="4" style="width:100%;box-sizing:border-box" readonly placeholder="Bấm nút Google để lấy token…"></textarea>
    <button id="copyBtn" style="margin-top:6px;padding:6px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;cursor:pointer">📋 Copy toàn bộ token</button>
    <h3 style="margin-bottom:4px">Response từ API</h3>
    <pre id="result" style="background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow:auto;min-height:60px;font-size:12px">(chưa gọi)</pre>
  </div>
  <script>
    // One Tap chỉ mở khi NGƯỜI DÙNG bấm (auto_prompt=false) — prompt tự bật mà bị đóng
    // sẽ ăn án phạt cooldown của Chrome, làm trải nghiệm test cực khó chịu.
    const oneTapBtn = document.getElementById('oneTapBtn');
    if (oneTapBtn) oneTapBtn.onclick = () => {
      if (window.google?.accounts?.id) window.google.accounts.id.prompt();
      else alert('Script Google chưa tải xong — đợi 1-2 giây rồi bấm lại.');
    };
    document.getElementById('copyBtn').onclick = async () => {
      const ta = document.getElementById('token');
      if (!ta.value) { alert('Chưa có token — bấm nút Google trước.'); return; }
      ta.select();
      try { await navigator.clipboard.writeText(ta.value); } catch { document.execCommand('copy'); }
      const btn = document.getElementById('copyBtn');
      btn.textContent = '✅ Đã copy ' + ta.value.length + ' ký tự';
      setTimeout(() => { btn.textContent = '📋 Copy toàn bộ token'; }, 2500);
    };
    window.onCredential = async (resp) => {
      document.getElementById('token').value = resp.credential;
      const out = document.getElementById('result');
      out.textContent = 'Đang gọi POST /api/auth/google…';
      try {
        const r = await fetch('/api/auth/google', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: resp.credential }),
        });
        out.textContent = 'HTTP ' + r.status + '\\n' + JSON.stringify(await r.json(), null, 2);
      } catch (e) {
        out.textContent = 'Lỗi gọi API: ' + e.message;
      }
    };
  </script>
</body></html>`;

export const googleTestPage = asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    throw new AppError('Not found', 404, 'NOT_FOUND');
  }
  res.removeHeader('Content-Security-Policy'); // trang dev có script inline + script Google
  // Helmet mặc định đặt Referrer-Policy: no-referrer → iframe nút GSI mất header Referer,
  // Google không xác minh được origin và trả 400 "origin is not allowed". Nút Google
  // BẮT BUỘC trang nhúng phải gửi origin qua Referer.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Helmet mặc định COOP: same-origin → popup đăng nhập mất window.opener, chọn tài khoản
  // xong không postMessage token về trang được (popup trắng). 'same-origin-allow-popups'
  // giữ bảo vệ COOP nhưng cho phép popup do trang này mở giữ liên kết ngược.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.status(200).type('html').send(googleTestHtml(isGoogleConfigured() ? process.env.GOOGLE_CLIENT_ID : null));
});

// ---------- MOBILE GOOGLE SIGN-IN ----------
// Serves an HTML page with Google Identity Services button for mobile apps.
// After the user signs in with Google, the page calls POST /api/auth/google internally,
// gets the JWT, and redirects to the mobile app's custom URL scheme (pmbs-mobile://auth).
const googleMobileHtml = (clientId) => `<!doctype html>
<html lang="vi"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PBMS - Đăng nhập Google</title>
<script src="https://accounts.google.com/gsi/client" async defer><\/script>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:24px}
  .card{background:#fff;border-radius:20px;padding:40px 32px;max-width:380px;
    width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.15)}
  .logo{width:56px;height:56px;border-radius:16px;background:#4f46e5;
    display:flex;align-items:center;justify-content:center;margin:0 auto 20px;
    font-size:24px;color:#fff;font-weight:bold}
  h2{color:#0f172a;font-size:22px;margin-bottom:8px}
  p{color:#64748b;font-size:14px;line-height:1.5;margin-bottom:28px}
  #g-btn{display:flex;justify-content:center;min-height:44px}
  #status{margin-top:20px;font-size:13px;color:#64748b;min-height:20px}
  .spinner{display:inline-block;width:20px;height:20px;border:3px solid #e2e8f0;
    border-top-color:#4f46e5;border-radius:50%;animation:spin .8s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .error{color:#dc2626}
</style></head>
<body>
  <div class="card">
    <div class="logo">P</div>
    <h2>Đăng nhập với Google</h2>
    <p>Chọn tài khoản Google để đăng nhập hoặc tạo tài khoản PBMS tự động.</p>
    <div id="g-btn"></div>
    <div id="status"></div>
  </div>
  <script>
    var STATUS=document.getElementById('status');
    window.onCredential=async function(resp){
      STATUS.innerHTML='<span class="spinner"></span> Đang xử lý...';
      try{
        var r=await fetch(location.origin+'/api/auth/google',{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({idToken:resp.credential})});
        var json=await r.json();
        if(!r.ok){STATUS.innerHTML='<span class="error">'+(json?.error?.message||'Đăng nhập thất bại')+'</span>';return}
        var token=json.data?.token||'';
        var user=btoa(unescape(encodeURIComponent(JSON.stringify(json.data?.user||{}))));
        var isNew=json.data?.isNew?'1':'0';
        window.location.href='pmbs-mobile://auth?token='+encodeURIComponent(token)
          +'&user='+encodeURIComponent(user)+'&isNew='+isNew;
      }catch(e){STATUS.innerHTML='<span class="error">Lỗi kết nối: '+e.message+'</span>'}
    };
    function initGsi(){
      if(!window.google?.accounts?.id){setTimeout(initGsi,200);return}
      google.accounts.id.initialize({client_id:'${clientId}',callback:onCredential,auto_select:false});
      google.accounts.id.renderButton(document.getElementById('g-btn'),
        {type:'standard',size:'large',text:'signin_with',width:300});
    }
    initGsi();
  <\/script>
</body></html>`;

export const googleMobilePage = asyncHandler(async (req, res) => {
  const clientId = isGoogleConfigured() ? process.env.GOOGLE_CLIENT_ID : null;
  if (!clientId) {
    throw new AppError('Google Sign-In chưa được cấu hình', 503, 'GOOGLE_NOT_CONFIGURED');
  }
  res.removeHeader('Content-Security-Policy');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  res.status(200).type('html').send(googleMobileHtml(clientId));
});
