// Reviews hub controller: every review on Checkpoint in one place, sorted and filtered, next to the top reviewers.
const express = require('express');
const { listHubReviews, listTopReviewers } = require('../database/review-details');
const { describeDetails, reviewerBadges } = require('../lib/review-insights');
const { formatDate, isoTime } = require('../lib/text');

const router = express.Router();

const PAGE_SIZE = 20;
const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'helpful', label: 'Most helpful' },
  { value: 'highest', label: 'Highest rated' },
  { value: 'lowest', label: 'Lowest rated' },
];

function readFilters(query) {
  const sort = SORTS.some((option) => option.value === query.sort) ? query.sort : 'newest';
  const stars = /^(?:[0-4]\.5|[1-5](?:\.0)?)$/.test(String(query.stars ?? '')) ? Number(query.stars) : 0;
  const hideSpoilers = query.spoilers === 'hide';
  const requested = Number.parseInt(query.page, 10);
  return { sort, stars, hideSpoilers, page: Number.isInteger(requested) && requested > 0 ? requested : 1 };
}

router.get('/reviews', (req, res, next) => {
  try {
    const viewerId = req.session.user?.id || 0;
    const filters = readFilters(req.query);
    let { total, reviews } = listHubReviews({
      viewerId, sort: filters.sort, stars: filters.stars, spoilers: !filters.hideSpoilers,
      limit: PAGE_SIZE, offset: (filters.page - 1) * PAGE_SIZE,
    });
    const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (filters.page > pageCount) {
      filters.page = pageCount;
      ({ total, reviews } = listHubReviews({
        viewerId, sort: filters.sort, stars: filters.stars, spoilers: !filters.hideSpoilers,
        limit: PAGE_SIZE, offset: (pageCount - 1) * PAGE_SIZE,
      }));
    }
    const reviewers = listTopReviewers({ viewerId, limit: 8 }).map((reviewer, index) => ({
      ...reviewer,
      rank: index + 1,
      badges: reviewerBadges(reviewer, index + 1),
    }));

    return res.render('reviews', {
      title: 'Player reviews',
      reviews: reviews.map((review) => {
        // Members with a private profile keep their reviews here, but not their name.
        const visible = Boolean(review.profile_public) || review.user_id === viewerId;
        return {
          ...review,
          user_name: visible ? review.user_name : 'Private member',
          authorLinked: visible,
          displayDate: formatDate(review.updated_at),
          datetime: isoTime(review.updated_at),
          details: describeDetails(review),
        };
      }),
      reviewers,
      total,
      page: filters.page,
      pageCount,
      filters,
      sorts: SORTS,
    });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
