(() => {
  const applyHeroArtwork = () => {
    const shoe = document.querySelector(".hero-reference .hero-product");
    if (!shoe) return;
    shoe.style.backgroundImage = "url('/bf-shoes-hero.svg')";
    shoe.style.backgroundRepeat = "no-repeat";
    shoe.style.backgroundPosition = "center";
    shoe.style.backgroundSize = "contain";
    shoe.setAttribute("role", "img");
    shoe.setAttribute("aria-label", "BF SHOES signature sneaker in monochrome");
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyHeroArtwork, { once: true });
  } else {
    applyHeroArtwork();
  }
})();
