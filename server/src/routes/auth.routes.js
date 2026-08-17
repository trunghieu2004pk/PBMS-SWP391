import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { auth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  registerValidator,
  loginValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  googleValidator,
  verifyEmailValidator,
  resendVerificationValidator,
  updateMeValidator,
} from '../validators/auth.validator.js';
import { authRateLimiter } from '../middleware/security.js';

const router = Router();

router.post('/register',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'ÄÄƒng kÃ½ (role User, email báº¯t buá»™c)'
     #swagger.security = []
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { username: 'khachhang01', password: 'matkhau123', fullName: 'Nguyá»…n VÄƒn A', email: 'a@gmail.com', phone: '0900000000' } } } } */
  authRateLimiter, registerValidator, validate, authController.register);

router.post('/login',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'ÄÄƒng nháº­p (tráº£ vá» token JWT)'
     #swagger.security = []
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { username: 'admin', password: 'matkhau' } } } } */
  authRateLimiter, loginValidator, validate, authController.login);

router.post('/google',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'ÄÄƒng nháº­p Google (ID token)'
     #swagger.security = []
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { idToken: '<google_id_token>' } } } } */
  authRateLimiter, googleValidator, validate, authController.googleLogin);

router.get('/google-test',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'Trang test Ä‘Äƒng nháº­p Google (chá»‰ dev â€” 404 á»Ÿ production)'
     #swagger.security = [] */
  authController.googleTestPage); // má»Ÿ báº±ng trÃ¬nh duyá»‡t Ä‘á»ƒ láº¥y ID token tháº­t + gá»i thá»­ API

router.post('/forgot-password',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'QuÃªn máº­t kháº©u (gá»­i email link reset)'
     #swagger.security = []
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { email: 'a@gmail.com' } } } } */
  authRateLimiter, forgotPasswordValidator, validate, authController.forgotPassword);

router.post('/reset-password',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'Äáº·t láº¡i máº­t kháº©u báº±ng token'
     #swagger.security = []
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { email: 'a@gmail.com', token: '<token-tá»«-email>', newPassword: 'matkhaumoi' } } } } */
  authRateLimiter, resetPasswordValidator, validate, authController.resetPassword);

router.get('/verify-email',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'XÃ¡c minh email qua link (GET â†’ trang HTML)'
     #swagger.security = [] */
  authController.verifyEmailPage); // báº¥m link trong email (GET) â†’ trang HTML

router.post('/verify-email',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'XÃ¡c minh email báº±ng token (POST)'
     #swagger.security = []
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { email: 'a@gmail.com', token: '<token-tá»«-email>' } } } } */
  authRateLimiter, verifyEmailValidator, validate, authController.verifyEmail);

router.post('/resend-verification',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'Gá»­i láº¡i email xÃ¡c minh'
     #swagger.security = []
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { email: 'a@gmail.com' } } } } */
  authRateLimiter, resendVerificationValidator, validate, authController.resendVerification);

router.get('/me',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'ThÃ´ng tin user hiá»‡n táº¡i' */
  auth, authController.getMe);

router.patch('/me',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'Cáº­p nháº­t há»“ sÆ¡ (há» tÃªn, SÄT, tÃ i khoáº£n ngÃ¢n hÃ ng nháº­n hoÃ n tiá»n)'
     #swagger.requestBody = { required: true, content: { 'application/json': { example: { fullName: 'Nguyá»…n VÄƒn A', phone: '0912345678', bankName: 'Vietcombank', bankAccountNumber: '0123456789', bankAccountHolder: 'NGUYEN VAN A' } } } } */
  auth, updateMeValidator, validate, authController.updateMe);


router.get('/google/mobile',
  /* #swagger.tags = ['Auth']
     #swagger.summary = 'Trang đăng nhập Google cho mobile app (mở trong WebBrowser)'
     #swagger.security = [] */
  authController.googleMobilePage);

export default router;
