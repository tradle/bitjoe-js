
'use strict';

module.exports = function(app) {
  app.use('/transaction', require('./routes/transaction'));
  app.use('/bootstrap', require('./routes/bootstrap'));
  app.use('/hooks', require('./routes/hooks'));
  if (app.get('joe').isTestnet())
    app.use('/refund', require('./routes/refund'));
}