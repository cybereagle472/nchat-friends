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
    // Convert data URL to Blob using fetch (works in Node.js action runtime)
    const response = await fetch(dataUrl);
    if (!response.ok) {
      throw new Error("Failed to read image data");
    }
    const blob = await response.blob();

    // Validate file size (max 5MB)
    if (blob.size > 5 * 1024 * 1024) {
      throw new Error("File too large. Maximum size is 5MB");
    }

    const file = new File([blob], filename, { type: mimeType });

    const storageId = await ctx.storage.store(file);
    const url = await ctx.storage.getUrl(storageId);

    if (!url) {
      throw new Error("Failed to get storage URL");
    }

    return { storageId: storageId as string, url };
  },
});
