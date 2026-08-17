const db = require("../config/database");
const config = require("../config/smilepayz");
const logger = require("../utils/logger");
const { ALL_CREATE_SQL } = require("./schema");

const syncGatewayTables = async () => {
  for (const sql of ALL_CREATE_SQL) {
    await db.query(sql);
  }

  if (config.partnerId) {
    await db.execute(
      `INSERT INTO smilepayz_merchants (merchant_id, name, status)
       VALUES (?, ?, 'active')
       ON DUPLICATE KEY UPDATE name = VALUES(name), status = 'active'`,
      [config.partnerId, config.merchantName || "rollix777"]
    );
  }

  logger.info("Database", "Gateway tables synced (smilepayz_*)");
};

module.exports = { syncGatewayTables };
