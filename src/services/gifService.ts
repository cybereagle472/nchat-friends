/**
 * GIF Service using Giphy API
 * Provides GIF search and trending functionality
 */

// You can get a free API key from https://developers.giphy.com/
const GIPHY_API_KEY = import.meta.env.VITE_GIPHY_API_KEY || 'dc6zaTOxFJmzC'; // Demo key
const GIPHY_BASE_URL = 'https://api.giphy.com/v1/gifs';

export interface GifObject {
  id: string;
  title: string;
  url: string;
  previewUrl: string;
  width: number;
  height: number;
}

export interface GifSearchResult {
  gifs: GifObject[];
  pagination: {
    total_count: number;
    count: number;
    offset: number;
  };
}

class GifService {
  /**
   * Search for GIFs
   */
  async search(query: string, limit: number = 25, offset: number = 0): Promise<GifSearchResult> {
    try {
      const params = new URLSearchParams({
        api_key: GIPHY_API_KEY,
        q: query,
        limit: limit.toString(),
        offset: offset.toString(),
        rating: 'pg-13',
        lang: 'en'
      });

      const response = await fetch(`${GIPHY_BASE_URL}/search?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to search GIFs');
      }

      return {
        gifs: this.transformGifs(data.data),
        pagination: data.pagination
      };
    } catch (error) {
      console.error('GIF search error:', error);
      return { gifs: [], pagination: { total_count: 0, count: 0, offset: 0 } };
    }
  }

  /**
   * Get trending GIFs
   */
  async getTrending(limit: number = 25, offset: number = 0): Promise<GifSearchResult> {
    try {
      const params = new URLSearchParams({
        api_key: GIPHY_API_KEY,
        limit: limit.toString(),
        offset: offset.toString(),
        rating: 'pg-13'
      });

      const response = await fetch(`${GIPHY_BASE_URL}/trending?${params}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Failed to get trending GIFs');
      }

      return {
        gifs: this.transformGifs(data.data),
        pagination: data.pagination
      };
    } catch (error) {
      console.error('Trending GIF error:', error);
      return { gifs: [], pagination: { total_count: 0, count: 0, offset: 0 } };
    }
  }

  /**
   * Get GIF categories
   */
  async getCategories(): Promise<string[]> {
    // Common GIF categories
    return [
      'reactions',
      'entertainment',
      'sports',
      'stickers',
      'artists',
      'animals',
      'actions',
      'anime',
      'cartoons',
      'emotions',
      'food-drink',
      'gaming',
      'holidays',
      'memes',
      'movies',
      'music',
      'nature',
      'science',
      'tv'
    ];
  }

  /**
   * Transform Giphy API response to our format
   */
  private transformGifs(data: any[]): GifObject[] {
    return data.map(gif => ({
      id: gif.id,
      title: gif.title || '',
      url: gif.images.original.url || gif.images.fixed_height.url,
      previewUrl: gif.images.fixed_height_small?.url || gif.images.preview_gif?.url || gif.images.fixed_height.url,
      width: parseInt(gif.images.original.width) || 200,
      height: parseInt(gif.images.original.height) || 200
    }));
  }
}

export const gifService = new GifService();
export default gifService;
