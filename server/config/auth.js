function isEmailVerificationRequired() {
  return process.env.EMAIL_VERIFICATION_REQUIRED !== 'false';
}

module.exports = { isEmailVerificationRequired };
