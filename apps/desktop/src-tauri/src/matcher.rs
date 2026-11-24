//! Cached glob compiler used by extension URL matching.

use std::collections::HashMap;
use std::sync::{OnceLock, RwLock};

#[derive(Clone, Debug)]
pub struct CompiledGlob {
    tokens: Vec<Token>,
}

#[derive(Clone, Debug)]
enum Token {
    Literal(char),
    Any,
    Star,
}

static CACHE: OnceLock<RwLock<HashMap<String, CompiledGlob>>> = OnceLock::new();

fn cache() -> &'static RwLock<HashMap<String, CompiledGlob>> {
    CACHE.get_or_init(|| RwLock::new(HashMap::new()))
}

pub fn compile(pattern: &str) -> CompiledGlob {
    if let Ok(Some(found)) = cache().read().map(|g| g.get(pattern).cloned()) {
        return found;
    }
    let compiled = CompiledGlob {
        tokens: pattern
            .chars()
            .map(|c| match c {
                '*' => Token::Star,
                '?' => Token::Any,
                other => Token::Literal(other),
            })
            .collect(),
    };
    if let Ok(mut guard) = cache().write() {
        guard.insert(pattern.to_string(), compiled.clone());
    }
    compiled
}

pub fn is_match(compiled: &CompiledGlob, text: &str) -> bool {
    let pattern: Vec<char> = compiled
        .tokens
        .iter()
        .map(|token| match token {
            Token::Literal(c) => *c,
            Token::Any => '?',
            Token::Star => '*',
        })
        .collect();
    let text: Vec<char> = text.chars().collect();
    let (mut pi, mut ti, mut star, mut mark) = (0usize, 0usize, None, 0usize);
    while ti < text.len() {
        if pi < pattern.len() && (pattern[pi] == '?' || pattern[pi] == text[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < pattern.len() && pattern[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(index) = star {
            pi = index + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len()
}

pub fn cache_pattern(pattern: &str) {
    let _ = compile(pattern);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_glob_matches() {
        let pattern = compile("https://*.example.com/*");
        assert!(is_match(&pattern, "https://news.example.com/a"));
        assert!(!is_match(&pattern, "http://news.example.com/a"));
    }
}
