import { Router } from "express";
import { ApiError } from "@/core/errors";
import {
  isGuestRetentionJobAuthorized,
  runGuestRetentionPurge,
} from "@/lib/api/v1/guest-retention";

export const guestRetentionRouter = Router();

guestRetentionRouter.post("/jobs/guest-retention/purge", async (req, res, next) => {
  try {
    if (!isGuestRetentionJobAuthorized(req.get("authorization") ?? undefined)) {
      throw new ApiError("forbidden", "Guest retention job token required.");
    }
    const result = await runGuestRetentionPurge();
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});
