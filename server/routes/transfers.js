const express = require('express');
const router = express.Router();

// A transfer supplier has not been connected yet. Returning an explicit
// unavailable response prevents synthetic offers from being mistaken for
// bookable inventory.
router.get('/search', (req, res) => {
  res.status(503).json({
    error: 'Live transfer provider is not configured',
    code: 'TRANSFER_PROVIDER_UNAVAILABLE',
    transfers: [],
    total: 0,
  });
});

module.exports = router;
