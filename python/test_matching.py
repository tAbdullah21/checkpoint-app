import unittest
from matching import match


def game(slug, genre, tags='', platforms='steam', rating=4):
    return dict(slug=slug, title=slug.title(), genre=genre, tags=tags,
                platforms=platforms, rating=rating, description=genre+' adventure', year=2025)


class MatchingTests(unittest.TestCase):
    def setUp(self):
        self.games = [game('rpg-known', 'RPG', 'open world'), game('rpg-new', 'RPG', 'open world'),
                      game('racing', 'Racing', 'driving'), game('horror', 'Horror', 'scary')]

    def run_match(self, **taste):
        return match({'games': self.games, 'taste': taste})

    def test_personalizes_and_excludes_all_known_games(self):
        result = self.run_match(history=[{'slug': 'rpg-known', 'rating': 4.5}, {'slug': 'horror', 'status': 'want_to_play'}])
        self.assertEqual(result['picks'][0]['slug'], 'rpg-new')
        self.assertEqual({p['slug'] for p in result['picks']}, {'rpg-new', 'racing'})
        self.assertIn('4.5★', result['picks'][0]['reason'])
        self.assertTrue(all(0 <= p['match'] <= 100 for p in result['picks']))

    def test_half_star_feedback_changes_matching(self):
        low = self.run_match(history=[{'slug': 'rpg-known', 'rating': .5}], favoriteGenres=['Racing'])
        high = self.run_match(history=[{'slug': 'rpg-known', 'rating': 4.5}], favoriteGenres=['Racing'])
        score = lambda result: next(p['score'] for p in result['scores'] if p['slug'] == 'rpg-new')
        self.assertGreater(score(high), score(low))

    def test_cold_start_has_no_fake_match_percentages(self):
        result = self.run_match()
        self.assertTrue(result['isColdStart'])
        self.assertTrue(all(p['match'] is None for p in result['picks']))

    def test_platform_and_genre_preferences(self):
        self.games = [game('console', 'RPG', platforms='playstation'), game('pc', 'RPG')]
        result = self.run_match(favoriteGenres=['RPG'], preferredPlatform='playstation')
        self.assertEqual(result['picks'][0]['slug'], 'console')
        self.assertFalse(result['isColdStart'])

    def test_top_five_and_more_are_unique_and_sorted(self):
        self.games += [game(f'extra-{i}', 'RPG', rating=3+i/10) for i in range(10)]
        result = self.run_match(favoriteGenres=['RPG'])
        picks = result['picks']
        self.assertEqual(len(picks[:5]), 5)
        self.assertGreater(len(picks[5:]), 0)
        self.assertEqual(len({p['slug'] for p in picks}), len(picks))
        self.assertEqual([p['score'] for p in picks], sorted([p['score'] for p in picks], reverse=True))
        self.assertEqual(result, self.run_match(favoriteGenres=['RPG']))

    def test_dismissal_excludes_games_and_changes_similar_scores(self):
        baseline = self.run_match(favoriteGenres=['RPG', 'Racing'])
        hidden = self.run_match(favoriteGenres=['RPG', 'Racing'], dismissed=['rpg-known'])
        self.assertNotIn('rpg-known', [p['slug'] for p in hidden['picks']])
        score = lambda data: next(p['score'] for p in data['scores'] if p['slug'] == 'rpg-new')
        self.assertLess(score(hidden), score(baseline))
        cold = self.run_match(dismissed=['rpg-known'])
        self.assertNotIn('rpg-known', [p['slug'] for p in cold['picks']])
        self.assertEqual(baseline, self.run_match(favoriteGenres=['RPG', 'Racing'], dismissed=[]))

    def test_empty_catalogue_and_all_known(self):
        self.assertEqual(match({'games': [], 'taste': {}})['picks'], [])
        self.assertEqual(self.run_match(history=[{'slug': g['slug'], 'rating': 5} for g in self.games])['picks'], [])


if __name__ == '__main__':
    unittest.main()
