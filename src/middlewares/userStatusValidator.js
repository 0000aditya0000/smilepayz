const db = require("../config/database");
const logger = require("../utils/logger");

const validateUserStatus = async (req, res, next) => {
  const userId = req.body.userId;

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: "userId is required",
    });
  }

  try {
    const sql = "SELECT status FROM users WHERE id = ? LIMIT 1";
    const [results] = await db.execute(sql, [userId]);

    if (results && results.length > 0) {
      const userStatus = results[0].status;
      if (userStatus !== 1) {
        logger.warn("User not allowed to recharge - invalid status", {
          operation: "user_status_denied",
          user_id: userId,
          status: userStatus,
        });
        return res.status(403).json({
          success: false,
          error: "Not allowed to recharge - user account is not active",
        });
      }
      req.userStatus = userStatus;
      return next();
    }

    return res.status(404).json({
      success: false,
      error: "User not found",
    });
  } catch (error) {
    logger.logError("UserStatus", "Error validating user status", error, { userId });
    return res.status(500).json({
      success: false,
      error: "Error validating user status",
    });
  }
};

module.exports = { validateUserStatus };
