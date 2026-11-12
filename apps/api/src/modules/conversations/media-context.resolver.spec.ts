import { MediaContextResolver, MediaReference } from './media-context.resolver';

const PRODUCT = '5d041fb6-0000-0000-0000-000000000000';

function setup(
  opts: {
    linked?: boolean;
    confirmed?: boolean;
    phash?: { productId: string; color: string | null } | null;
    photo?: { productId: string; color: string | null; matchMethod: string } | null;
  } = {},
) {
  const content = {
    findByMediaId: jest.fn(async () =>
      opts.linked ? { productId: PRODUCT, linkedColor: 'Білий', confirmed: opts.confirmed ?? true } : null,
    ),
    matchCustomerPhoto: jest.fn(async () => opts.photo ?? null),
    persistCustomerPhotoMatch: jest.fn(async () => undefined),
    saveUnlinkedMedia: jest.fn(async () => undefined),
    resolveMediaIdByPostUrl: jest.fn(async () => null),
  };
  const contentMedia = { matchCatalogImage: jest.fn(async () => opts.phash ?? null) };
  const dataSource = { query: jest.fn(async () => [{ title: 'Сукня льон' }]) };
  const resolver = new MediaContextResolver(content as never, contentMedia as never, dataSource as never);
  const resolve = (ref: MediaReference) => resolver.resolve('t1', 'c1', [ref], '');
  return { resolve, content, contentMedia };
}

const STORY: MediaReference = { type: 'story_reply', mediaId: 's1', url: '/uploads/content-media/t1/s.jpg', image: 'picture' };

describe('MediaContextResolver: stories, posts and reels', () => {
  it('names the linked product first, without looking at the image', async () => {
    const t = setup({ linked: true, phash: { productId: 'other', color: null } });
    const out = await t.resolve(STORY);

    expect(out.productId).toBe(PRODUCT);
    expect(out.notes[0]).toBe(
      "The customer replied to the shop's story showing «Сукня льон» (ref 5d041fb6, colour «Білий»). " +
        'Their message is about this product unless they say otherwise; check it with get_product. ' +
        "If it is in stock in that colour, offer this product, not alternatives. If it isn't, or not in the size they " +
        'want, say so plainly, then offer the closest alternatives.',
    );
    expect(t.contentMedia.matchCatalogImage).not.toHaveBeenCalled();
  });

  it("offers an automatic match nobody confirmed as the likely item, not a certain one", async () => {
    const out = await setup({ linked: true, confirmed: false }).resolve(STORY);
    expect(out.productId).toBe(PRODUCT);
    expect(out.notes[0]).toContain("replied to the shop's story, probably showing «Сукня льон» (ref 5d041fb6, colour «Білий»)");
    expect(out.notes[0]).toContain('offer it as the likely item, not a certain one');
    expect(out.notes[0]).not.toContain('not alternatives');
  });

  it('then matches our copy to a catalog photo by perceptual hash', async () => {
    const t = setup({ phash: { productId: PRODUCT, color: null } });
    const out = await t.resolve(STORY);

    expect(t.contentMedia.matchCatalogImage).toHaveBeenCalledWith('t1', STORY.url);
    expect(out.productId).toBe(PRODUCT);
    expect(out.notes[0]).toContain('showing «Сукня льон» (ref 5d041fb6)');
    expect(out.notes[0]).toContain('If it is in stock, offer this product, not alternatives.');
    // Never the heavy photo matching for content.
    expect(t.content.matchCustomerPhoto).not.toHaveBeenCalled();
  });

  it('otherwise tells the agent to identify the product from the image it sees, text first', async () => {
    const t = setup();
    const out = await t.resolve(STORY);

    expect(out.productId).toBeNull();
    expect(out.notes[0]).toContain("The customer replied to the shop's story; it is in the image above");
    expect(out.notes[0]).toContain('Read the text on it first (a name, an article, a price)');
    expect(out.notes[0]).toContain('search_products (sku for an article, price for a price) or browse_category');
    // Only an article or an exact name identifies it; a look-alike is offered as one of the closest, never as the item.
    expect(out.notes[0]).toContain('An article, or a name that fits exactly one product, identifies it');
    expect(out.notes[0]).toContain('if that product is in stock, offer only it; if not, say so, then offer the closest alternatives');
    expect(out.notes[0]).toContain("say you don't see exactly this item, or can't tell which model it is");
    expect(out.notes[0]).toContain('show the closest two or three with show_products');
    expect(out.notes[0]).toContain('If it shows several items, show them with show_products and ask which one.');
    expect(out.notes[0]).not.toContain('another account');
    expect(t.content.matchCustomerPhoto).not.toHaveBeenCalled();
  });

  it("doesn't hash a sheet of video frames, and says the image is frames", async () => {
    const t = setup();
    const out = await t.resolve({ ...STORY, image: 'video_frames' });
    expect(t.contentMedia.matchCatalogImage).not.toHaveBeenCalled();
    expect(out.notes[0]).toContain('frames from its video are in the image above');
  });

  it("says another account's post only looks like a product, and doesn't record it as the shop's", async () => {
    const t = setup();
    const out = await t.resolve({ type: 'post_share', mediaId: 'p9', url: '/uploads/content-media/t1/p.jpg', image: 'picture', foreign: true, reel: true });
    expect(out.notes[0]).toContain('The customer shared a reel from another account');
    expect(out.notes[0]).toContain("so no product is the same item: say the ones you find look like it, never that they're the same");
    expect(out.notes[0]).not.toContain('offer only it');
    expect(t.content.saveUnlinkedMedia).not.toHaveBeenCalled();
  });

  it('asks for names rather than photos on a comment, whose answer is text only', async () => {
    const t = setup();
    const out = await t.resolve({ type: 'post_comment', mediaId: 'p1', url: '/uploads/content-media/t1/p.jpg', image: 'picture' });
    expect(out.notes[0]).toContain("commented under the shop's post");
    expect(out.notes[0]).toContain('name the closest two or three briefly');
    expect(out.notes[0]).toContain('name them briefly and ask which one');
    expect(out.notes[0]).not.toContain('show_products');
  });

  it('falls back to the caption, then to asking what they mean', async () => {
    const withCaption = await setup().resolve({ type: 'post_share', mediaId: 'p1', caption: 'Сукня льон' });
    expect(withCaption.notes[0]).toContain("you can't see it, only its caption");
    expect(withCaption.notes[0]).toContain("can't tell from the caption which product it is");
    expect(withCaption.notes[0]).toContain('offer what the shop has rather than asking them to describe it');

    const t = setup();
    const bare = await t.resolve({ type: 'story_reply', mediaId: 's2' });
    expect(bare.notes[0]).toContain('Ask what they mean');
    // Recorded so the store can link it; stories under the type the content fetch uses.
    expect(t.content.saveUnlinkedMedia).toHaveBeenCalledWith('t1', 's2', 'story');
  });
});

describe('MediaContextResolver: customer photos', () => {
  const PHOTO: MediaReference = { type: 'customer_photo', mediaId: 'https://cdn/p.jpg' };

  it('is sure of the same image, and only likely about a visual match', async () => {
    const exact = await setup({ photo: { productId: PRODUCT, color: null, matchMethod: 'customer_photo_phash' } }).resolve(PHOTO);
    expect(exact.notes[0]).toContain('sent a photo showing «Сукня льон»');
    expect(exact.notes[0]).toContain('offer this product, not alternatives');

    const visual = await setup({ photo: { productId: PRODUCT, color: null, matchMethod: 'customer_photo_vision' } }).resolve(PHOTO);
    expect(visual.notes[0]).toContain('sent a photo, probably showing «Сукня льон»');
  });
});
