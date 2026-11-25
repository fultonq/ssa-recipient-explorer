// Rust port of the engine's hot path (generate + compile + scan + sort window + aggregate),
// written to mirror engine/src/engine.cpp algorithm-for-algorithm so the comparison measures
// the language/compiler, not a different design. Same RNG, same tables, same results.
mod tables;
use std::cmp::Ordering;
use std::time::Instant;
use tables::*;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E3779B97F4A7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D049BB133111EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u32) -> u32 { ((self.next() >> 11) % n as u64) as u32 }
    fn real(&mut self) -> f64 { (self.next() >> 11) as f64 * (1.0 / 9007199254740992.0) }
    fn range(&mut self, lo: i32, hi: i32) -> i32 { lo + self.below((hi - lo + 1) as u32) as i32 }
    fn normal(&mut self, mean: f64, sd: f64) -> f64 {
        let u1 = self.real().max(1e-12);
        let u2 = self.real();
        mean + sd * (-2.0 * u1.ln()).sqrt() * (6.283185307179586 * u2).cos()
    }
    fn skewed(&mut self, n: u32) -> u32 {
        let u = self.real();
        ((n as f64 * u * u) as u32).min(n - 1)
    }
}

#[derive(Clone, Copy, PartialEq)]
enum SortKey { Id, LastName, Benefit }

struct Filter {
    text: String,
    state_mask: u64,
    type_mask: u8,
    status_mask: u8,
    min_cents: u32,
    max_cents: u32,
    id: i64,
}
impl Default for Filter {
    fn default() -> Self {
        Filter { text: String::new(), state_mask: !0, type_mask: 0xFF, status_mask: 0xFF, min_cents: 0, max_cents: u32::MAX, id: -1 }
    }
}

struct Compiled {
    impossible: bool,
    has_id: bool,
    id_row: usize,
    state_mask: u64,
    type_mask: u8,
    status_mask: u8,
    min_c: u32,
    max_c: u32,
    name_full: u8,
    fm: Vec<u8>,
    lm: Vec<u8>,
}

struct Stats {
    count: u64,
    sum: u64,
    min: u32,
    max: u32,
    by_state: [u64; 52],
    by_type: [u64; 6],
    by_status: [u64; 4],
    hist: [u64; 12],
}
impl Stats {
    fn new() -> Self {
        Stats { count: 0, sum: 0, min: 0, max: 0, by_state: [0; 52], by_type: [0; 6], by_status: [0; 4], hist: [0; 12] }
    }
}

struct Engine {
    n: usize,
    first_dict: Vec<String>,
    last_dict: Vec<String>,
    first: Vec<u16>,
    last: Vec<u16>,
    last4: Vec<u16>,
    birth: Vec<u16>,
    ent: Vec<u16>,
    zip3: Vec<u16>,
    cents: Vec<u32>,
    state: Vec<u8>,
    typ: Vec<u8>,
    status: Vec<u8>,
}

fn build_dict(base: &[String]) -> (Vec<String>, Vec<u16>) {
    let mut dict: Vec<String> = base.to_vec();
    dict.sort();
    dict.dedup();
    let map = base.iter().map(|b| dict.binary_search(b).unwrap() as u16).collect();
    (dict, map)
}

impl Engine {
    fn generate(n: usize, seed: u64) -> Engine {
        let first_base: Vec<String> = FIRST.iter().map(|s| s.to_string()).collect();
        let mut last_base: Vec<String> = LAST_BASE.iter().map(|s| s.to_string()).collect();
        for p in PRE { for s in SUF { last_base.push(format!("{p}{s}")); } }
        let (first_dict, fmap) = build_dict(&first_base);
        let (last_dict, lmap) = build_dict(&last_base);

        let mut cum = [0f64; 52];
        let mut total = 0.0;
        for (i, s) in STATES.iter().enumerate() { total += s.2; cum[i] = total; }

        let (nf, nl) = (first_base.len() as u32, last_base.len() as u32);
        let mut e = Engine {
            n, first_dict, last_dict,
            first: vec![0; n], last: vec![0; n], last4: vec![0; n], birth: vec![0; n], ent: vec![0; n],
            zip3: vec![0; n], cents: vec![0; n], state: vec![0; n], typ: vec![0; n], status: vec![0; n],
        };
        let mut rng = Rng(seed);
        for i in 0..n {
            e.first[i] = fmap[rng.skewed(nf) as usize];
            e.last[i] = lmap[rng.skewed(nl) as usize];
            e.last4[i] = rng.below(10000) as u16;
            e.zip3[i] = rng.range(10, 998) as u16;
            let sp = rng.real() * total;
            e.state[i] = cum.partition_point(|&c| c < sp).min(51) as u8;

            let t = rng.real();
            let ty: u8 = if t < 0.54 { 0 } else if t < 0.67 { 1 } else if t < 0.76 { 2 } else if t < 0.88 { 3 } else if t < 0.93 { 4 } else { 5 };
            e.typ[i] = ty;
            let (birth, ent, cents): (i32, i32, f64);
            match ty {
                0 => {
                    birth = rng.normal(1953.0, 8.0).clamp(1928.0, 1964.0) as i32;
                    ent = 2026.min(birth + rng.range(62, 70));
                    cents = rng.normal(1900.0, 650.0).clamp(300.0, 4200.0) * 100.0;
                }
                1 => {
                    birth = rng.range(1958, 2004);
                    ent = 2026.min((birth + 20).max(rng.range(2000, 2026)));
                    cents = rng.normal(1500.0, 450.0).clamp(300.0, 3800.0) * 100.0;
                }
                2 => {
                    birth = rng.range(1930, 2010);
                    ent = 2026.min(birth.max(rng.range(1995, 2026)));
                    cents = rng.normal(1600.0, 550.0).clamp(300.0, 3600.0) * 100.0;
                }
                3 => {
                    birth = rng.range(1925, 2008);
                    ent = 2026.min(birth.max(rng.range(1974, 2026)));
                    cents = (100.0 + rng.real() * 894.0) * 100.0;
                }
                4 => {
                    birth = rng.range(1930, 1966);
                    ent = 2026.min(birth + rng.range(62, 68));
                    cents = rng.normal(950.0, 350.0).clamp(150.0, 2100.0) * 100.0;
                }
                _ => {
                    birth = rng.range(2007, 2025);
                    ent = 2026.min(birth.max(rng.range(2007, 2026)));
                    cents = rng.normal(750.0, 300.0).clamp(150.0, 1800.0) * 100.0;
                }
            }
            e.birth[i] = birth as u16;
            e.ent[i] = ent as u16;
            e.cents[i] = cents as u32;
            let s = rng.real();
            e.status[i] = if s < 0.92 { 0 } else if s < 0.95 { 1 } else if s < 0.97 { 2 } else { 3 };
        }
        e
    }

    fn compile(&self, f: &Filter) -> Compiled {
        let mut c = Compiled {
            impossible: false, has_id: false, id_row: 0,
            state_mask: f.state_mask & ((1u64 << 52) - 1), type_mask: f.type_mask & 0x3F, status_mask: f.status_mask & 0x0F,
            min_c: f.min_cents, max_c: f.max_cents, name_full: 0, fm: vec![], lm: vec![],
        };
        if c.state_mask == 0 || c.type_mask == 0 || c.status_mask == 0 || c.min_c > c.max_c { c.impossible = true; }
        if f.id >= 0 {
            if f.id == 0 || f.id as usize > self.n { c.impossible = true; } else { c.has_id = true; c.id_row = (f.id - 1) as usize; }
        }
        let tokens: Vec<String> = f.text.split_whitespace().take(8).map(|t| t.to_lowercase()).collect();
        if !tokens.is_empty() {
            c.name_full = ((1u32 << tokens.len()) - 1) as u8;
            let mask = |d: &String| {
                let l = d.to_lowercase();
                let mut m = 0u8;
                for (t, tok) in tokens.iter().enumerate() { if l.contains(tok.as_str()) { m |= 1 << t; } }
                m
            };
            c.fm = self.first_dict.iter().map(&mask).collect();
            c.lm = self.last_dict.iter().map(&mask).collect();
        }
        c
    }

    #[inline(always)]
    fn matches(&self, c: &Compiled, i: usize) -> bool {
        if (c.state_mask >> self.state[i]) & 1 == 0 || (c.type_mask >> self.typ[i]) & 1 == 0 || (c.status_mask >> self.status[i]) & 1 == 0 {
            return false;
        }
        let cents = self.cents[i];
        if cents < c.min_c || cents > c.max_c { return false; }
        if c.name_full != 0 && (c.fm[self.first[i] as usize] | c.lm[self.last[i] as usize]) != c.name_full { return false; }
        true
    }

    fn primary(&self, k: SortKey, a: u32, b: u32) -> Ordering {
        let (a, b) = (a as usize, b as usize);
        match k {
            SortKey::LastName => self.last[a].cmp(&self.last[b]).then(self.first[a].cmp(&self.first[b])),
            SortKey::Benefit => self.cents[a].cmp(&self.cents[b]),
            SortKey::Id => Ordering::Equal,
        }
    }

    /// Returns (total matches, requested page of row indices).
    fn query(&self, f: &Filter, sort: SortKey, desc: bool, offset: usize, limit: usize) -> (u64, Vec<u32>) {
        let c = self.compile(f);
        let mut m: Vec<u32> = Vec::with_capacity(self.n);
        if !c.impossible {
            if c.has_id {
                if self.matches(&c, c.id_row) { m.push(c.id_row as u32); }
            } else {
                for i in 0..self.n { if self.matches(&c, i) { m.push(i as u32); } }
            }
        }
        let total = m.len() as u64;
        let want = m.len().min(offset + limit);
        if offset >= want { return (total, vec![]); }
        if sort == SortKey::Id {
            let rows = if !desc { m[offset..want].to_vec() } else { (offset..want).map(|k| m[m.len() - 1 - k]).collect() };
            return (total, rows);
        }
        let less = |a: u32, b: u32| -> bool {
            let r = self.primary(sort, a, b);
            if r != Ordering::Equal { if desc { r == Ordering::Greater } else { r == Ordering::Less } } else if desc { a > b } else { a < b }
        };
        let cmp = |a: &u32, b: &u32| -> Ordering { if less(*a, *b) { Ordering::Less } else if less(*b, *a) { Ordering::Greater } else { Ordering::Equal } };
        const HEAP_WINDOW_MAX: usize = 8192;
        if want >= m.len() {
            m.sort_unstable_by(cmp);
        } else if want <= HEAP_WINDOW_MAX {
            partial_sort(&mut m, want, &less);
        } else {
            m.select_nth_unstable_by(want, cmp);
            m[..want].sort_unstable_by(cmp);
        }
        (total, m[offset..want].to_vec())
    }

    fn stats(&self, f: &Filter) -> Stats {
        let c = self.compile(f);
        let mut s = Stats::new();
        let (mut mn, mut mx) = (u32::MAX, 0u32);
        let mut add = |i: usize| {
            let cents = self.cents[i];
            s.count += 1;
            s.sum += cents as u64;
            mn = mn.min(cents);
            mx = mx.max(cents);
            s.by_state[self.state[i] as usize] += 1;
            s.by_type[self.typ[i] as usize] += 1;
            s.by_status[self.status[i] as usize] += 1;
            s.hist[((cents / 50_000) as usize).min(11)] += 1;
        };
        if !c.impossible {
            if c.has_id { if self.matches(&c, c.id_row) { add(c.id_row); } }
            else { for i in 0..self.n { if self.matches(&c, i) { add(i); } } }
        }
        s.min = if s.count > 0 { mn } else { 0 };
        s.max = mx;
        s
    }
}

fn sift_down<F: Fn(u32, u32) -> bool>(h: &mut [u32], mut i: usize, less: &F) {
    let n = h.len();
    loop {
        let l = 2 * i + 1;
        if l >= n { break; }
        let mut ch = l;
        if l + 1 < n && less(h[l], h[l + 1]) { ch = l + 1; }
        if less(h[i], h[ch]) { h.swap(i, ch); i = ch; } else { break; }
    }
}

/// Equivalent of std::partial_sort: heap over the first k, one pass over the rest.
fn partial_sort<F: Fn(u32, u32) -> bool>(m: &mut [u32], k: usize, less: &F) {
    let (head, tail) = m.split_at_mut(k);
    for i in (0..k / 2).rev() { sift_down(head, i, less); }
    for x in tail.iter_mut() {
        if less(*x, head[0]) { std::mem::swap(x, &mut head[0]); sift_down(head, 0, less); }
    }
    head.sort_unstable_by(|a, b| if less(*a, *b) { Ordering::Less } else if less(*b, *a) { Ordering::Greater } else { Ordering::Equal });
}

fn best_of<T>(mut f: impl FnMut() -> T) -> (f64, T) {
    let mut best = f64::MAX;
    let mut out = None;
    for _ in 0..5 {
        let t = Instant::now();
        let r = f();
        best = best.min(t.elapsed().as_secs_f64() * 1000.0);
        out = Some(r);
    }
    (best, out.unwrap())
}

fn st(code: &str) -> u64 { 1u64 << STATES.iter().position(|s| s.0 == code).unwrap() }

fn main() {
    let n: usize = std::env::args().nth(1).and_then(|a| a.parse().ok()).unwrap_or(5_000_000);
    let t0 = Instant::now();
    let e = Engine::generate(n, 2026);
    let gen = t0.elapsed().as_secs_f64() * 1000.0;
    let mem = e.n * 19;
    println!("generated {} records in {:.0} ms, {:.1} MB resident", n, gen, mem as f64 / 1048576.0);

    let report = |name: &str, ms: f64, total: u64, first: u32| println!("{:<46} {:>8.1} ms   total={} first={}", name, ms, total, first);
    let q = |name: &str, f: Filter, sort: SortKey, desc: bool, off: usize, lim: usize| {
        let (ms, (total, rows)) = best_of(|| e.query(&f, sort, desc, off, lim));
        report(name, ms, total, rows.first().copied().map(|r| r + 1).unwrap_or(0));
    };
    q("no filter, sort id", Filter::default(), SortKey::Id, false, 0, 50);
    q("no filter, sort benefit desc", Filter::default(), SortKey::Benefit, true, 0, 50);
    q("no filter, sort last name", Filter::default(), SortKey::LastName, false, 0, 50);
    q("text 'smith'", Filter { text: "smith".into(), ..Default::default() }, SortKey::Id, false, 0, 50);
    q("text 'mar smi' + MD/VA/DC", Filter { text: "mar smi".into(), state_mask: st("MD") | st("VA") | st("DC"), ..Default::default() }, SortKey::Id, false, 0, 50);
    q("Disability, Active, $1.2k-$2k, sort benefit", Filter { type_mask: 1 << 1, status_mask: 1 << 0, min_cents: 120_000, max_cents: 200_000, ..Default::default() }, SortKey::Benefit, false, 0, 50);
    q("deep page (offset 100000)", Filter::default(), SortKey::LastName, false, 100_000, 50);
    q("exact id", Filter { id: 1_234_567, ..Default::default() }, SortKey::Id, false, 0, 50);

    let (ms, s) = best_of(|| e.stats(&Filter::default()));
    report("stats, no filter", ms, s.count, s.sum as u32);
    let (ms, s) = best_of(|| e.stats(&Filter { type_mask: 1, state_mask: st("TX"), ..Default::default() }));
    report("stats, Retirement in TX", ms, s.count, s.sum as u32);
}
