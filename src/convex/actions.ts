import { v } from "convex/values";
import { action } from "./_generated/server";

/**
 * Server action: upload a file to Convex storage and return the
 * storage URL. Runs in a Node.js environment so it can fetch the
 * file contents from a data URL and stream them to Convex storage.
 */
export const uploadFile = action({
  args: {
    dataUrl: v.string(), // data URL: "data:<mime>;base64,<data>"
    filename: v.string(),
    mimeType: v.string(),
  },
  handler: async (ctx, { dataUrl, filename, mimeType }) => {
    // Extract the base64 portion from the data URL.
    const base64 = dataUrl.split(",")[1];
    if (!base64) throw new Error("Invalid data URL");

    const buffer = Buffer.from(base64, "base64");

    // Validate file size (max 10MB)
    if (buffer.length > 10 * 1024 * 1024) {
      throw new Error("File too large. Maximum size is 10MB");
    }

    const blob = new Blob([buffer], { type: mimeType });
    const file = new File([blob], filename, { type: mimeType });

    const storageId = await ctx.storage.store(file);
    const url = await ctx.storage.getUrl(storageId);
    
    if (!url) {
      throw new Error("Failed to get storage URL");
    }
    
    return { storageId: storageId as string, url };
  },
});
