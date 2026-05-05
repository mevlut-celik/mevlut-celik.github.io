const form = document.getElementById("applicationForm");
const feedback = document.getElementById("feedback");
const submitBtn = document.getElementById("submitBtn");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  feedback.textContent = "";
  feedback.className = "feedback";
  submitBtn.disabled = true;
  submitBtn.textContent = "Gönderiliyor...";

  try {
    const formData = new FormData(form);
    formData.set("kvkkConsent", String(document.getElementById("kvkkConsent").checked));

    const response = await fetch("/api/apply", {
      method: "POST",
      body: formData,
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || "Başvuru gönderilemedi.");
    }

    feedback.textContent = "Başvurunuz başarıyla gönderildi. Teşekkür ederiz.";
    feedback.classList.add("success");
    form.reset();
  } catch (error) {
    feedback.textContent = error.message || "Bir hata oluştu. Lütfen tekrar deneyiniz.";
    feedback.classList.add("error");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Başvuruyu Gönder";
  }
});
